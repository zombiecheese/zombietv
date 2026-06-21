/**
 * GET /api/plex-stream?contentId=8721&offsetSecs=2940
 *
 * Modes:
 * - Direct byte proxy: /api/plex-stream?contentId=...
 * - HLS manifest proxy: /api/plex-stream?contentId=...&format=hls
 * - Segment/key proxy: /api/plex-stream?proxyUrl=https%3A%2F%2Fplex...
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, SessionData } from '@/lib/session'

async function resolvePlexCredentials(session: SessionData): Promise<{ plexServerUrl: string; plexToken: string } | null> {
  if (session.isLoggedIn && session.plexServerUrl && session.plexToken) {
    return {
      plexServerUrl: session.plexServerUrl,
      plexToken: session.plexToken,
    }
  }
  return null
}

function buildPartFileUrl(base: string, partKey: string, plexToken: string): string {
  return `${base}${partKey}${partKey.includes('?') ? '&' : '?'}download=0&X-Plex-Token=${encodeURIComponent(plexToken)}`
}

function withPlexToken(url: string, plexToken: string): string {
  const next = new URL(url)
  if (!next.searchParams.get('X-Plex-Token')) {
    next.searchParams.set('X-Plex-Token', plexToken)
  }
  return next.toString()
}

function isPrivateIp(value: string): boolean {
  const ip = value.trim()
  if (!ip) return false
  if (ip === '::1' || ip === '127.0.0.1') return true

  // IPv4 private ranges
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true

  // IPv6 unique local and link-local
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(ip)) return true
  if (/^fe80:/i.test(ip)) return true

  return false
}

function inferPlaybackLocation(req: NextRequest): 'lan' | 'wan' {
  const xff = req.headers.get('x-forwarded-for') ?? ''
  const firstForwarded = xff.split(',')[0]?.trim() ?? ''
  if (firstForwarded && isPrivateIp(firstForwarded)) return 'lan'

  const realIp = req.headers.get('x-real-ip')?.trim() ?? ''
  if (realIp && isPrivateIp(realIp)) return 'lan'

  const host = (req.headers.get('host') ?? '').toLowerCase()
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return 'lan'

  return 'wan'
}

function normalizeClientSessionId(raw: string | null, fallbackUserId: string): string {
  if (raw && /^[A-Za-z0-9_-]{8,80}$/.test(raw)) return raw
  return `zombietv-${fallbackUserId}`
}

function buildHlsStartUrl(
  base: string,
  contentId: string,
  plexToken: string,
  offsetSecs: number,
  clientSessionId: string,
  location: 'lan' | 'wan',
  audioStreamId?: string,
  subtitleStreamId?: string,
): string {
  const params = new URLSearchParams({
    path: `/library/metadata/${contentId}`,
    mediaIndex: '0',
    partIndex: '0',
    protocol: 'hls',
    container: 'mpegts',
    // Let Plex decide direct play vs transcode based on device/network conditions.
    directPlay: '1',
    directStream: '1',
    location,
    fastSeek: '1',
    session: clientSessionId,
    offset: String(Math.max(0, offsetSecs)),
    maxVideoBitrate: location === 'lan' ? '20000' : '4000',
    'X-Plex-Product': 'ZombieTV',
    'X-Plex-Device-Name': 'ZombieTV Web',
    'X-Plex-Device': 'Web Browser',
    'X-Plex-Model': 'ZombieTV',
    'X-Plex-Platform': 'Web',
    'X-Plex-Client-Identifier': clientSessionId,
    'X-Plex-Session-Identifier': clientSessionId,
    'X-Plex-Token': plexToken,
  })
  if (audioStreamId)    params.set('audioStreamID', audioStreamId)
  if (subtitleStreamId) params.set('subtitleStreamID', subtitleStreamId)
  return `${base}/video/:/transcode/universal/start.m3u8?${params.toString()}`
}

async function proxyBinary(url: string, req: NextRequest, plexToken: string): Promise<NextResponse> {
  const urlWithToken = withPlexToken(url, plexToken)
  const range = req.headers.get('range')
  const upstream = await fetch(urlWithToken, {
    method: 'GET',
    headers: range ? { Range: range } : undefined,
    cache: 'no-store',
  })

  if (!upstream.ok && upstream.status !== 206) {
    return NextResponse.json(
      { error: 'Failed to fetch Plex media stream' },
      { status: 503 },
    )
  }

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase()
  if (contentType.includes('mpegurl') || contentType.includes('m3u8')) {
    const manifestText = await upstream.text()
    const rewritten = manifestText
      .split('\n')
      .map((line) => {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) return line
        const absolute = withPlexToken(new URL(trimmed, urlWithToken).toString(), plexToken)
        return `/api/plex-stream?proxyUrl=${encodeURIComponent(absolute)}`
      })
      .join('\n')

    return new NextResponse(rewritten, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  }

  const headers = new Headers()
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = upstream.headers.get(key)
    if (value) headers.set(key, value)
  }
  headers.set('Cache-Control', 'private, no-store, max-age=0')

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  })
}

export async function GET(req: NextRequest) {
  try {
    // Get session
    const sessionResponse = new NextResponse()
    const session = await getIronSession<SessionData>(req, sessionResponse, sessionOptions)

    const { searchParams } = new URL(req.url)
    const contentId = searchParams.get('contentId')
    const offsetSecs = Number.parseInt(searchParams.get('offsetSecs') || '0', 10) || 0
    const format = (searchParams.get('format') || '').toLowerCase()
    const proxyUrl = searchParams.get('proxyUrl')
    const requestedClientSessionId = searchParams.get('clientSessionId')
    const audioStreamId = searchParams.get('audioStreamId') ?? undefined
    const subtitleStreamId = searchParams.get('subtitleStreamId') ?? undefined

    if (!contentId && !proxyUrl) {
      return NextResponse.json(
        { error: 'Missing contentId or proxyUrl parameter' },
        { status: 400 }
      )
    }

    const creds = await resolvePlexCredentials(session)
    if (!creds) {
      return NextResponse.json(
        { error: 'Sign in with Plex to stream scheduled media.' },
        { status: 401 }
      )
    }

    const plexServerUrl = creds.plexServerUrl
    const plexToken = creds.plexToken
    const clientSessionId = normalizeClientSessionId(requestedClientSessionId, session.userId || 'viewer')
    const playbackLocation = inferPlaybackLocation(req)

    const base = plexServerUrl.replace(/\/$/, '')

    if (proxyUrl) {
      const target = decodeURIComponent(proxyUrl)
      const baseOrigin = new URL(base).origin
      const targetOrigin = new URL(target).origin
      if (targetOrigin !== baseOrigin) {
        return NextResponse.json({ error: 'Invalid proxy target' }, { status: 400 })
      }
      return await proxyBinary(target, req, plexToken)
    }
    
    // First, fetch media metadata to resolve the concrete file part key.
    const metadataUrl = `${base}/library/metadata/${contentId}?X-Plex-Token=${plexToken}`
    const metadataRes = await fetch(metadataUrl, { cache: 'no-store' })
    
    if (!metadataRes.ok) {
      console.error(`Plex metadata fetch failed: ${metadataRes.status}`)
      return NextResponse.json(
        { error: 'Failed to fetch Plex media metadata' },
        { status: 503 }
      )
    }

    const xmlText = await metadataRes.text()
    
    // Parse XML to find the Part key (looks like /library/parts/18540/file.ext)
    const partMatch = xmlText.match(/<Part[^>]*key="([^"]*\/library\/parts\/\d+[^"]*)"/);
    if (!partMatch) {
      console.error('Could not find Part key in Plex response')
      console.error('XML:', xmlText.substring(0, 500))
      return NextResponse.json(
        { error: 'Media part not found' },
        { status: 503 }
      )
    }

    const partKey = partMatch[1]
    console.log(`Requested contentId: ${contentId} → Found Plex part key: ${partKey}`)

    if (format === 'hls') {
      const hlsUrl = buildHlsStartUrl(base, contentId!, plexToken, offsetSecs, clientSessionId, playbackLocation, audioStreamId, subtitleStreamId)
      const manifestRes = await fetch(hlsUrl, { cache: 'no-store' })
      if (!manifestRes.ok) {
        console.error(`Plex HLS manifest fetch failed: ${manifestRes.status}`)
        return NextResponse.json(
          { error: 'Failed to fetch Plex HLS manifest' },
          { status: 503 },
        )
      }

      let manifestText = await manifestRes.text()
      let manifestBaseUrl = hlsUrl

      // If Plex returned a master playlist, unwrap to the first media playlist.
      const masterLines = manifestText.split('\n').map((line) => line.trim())
      const firstChild = masterLines.find((line) => line && !line.startsWith('#'))
      const isMaster = masterLines.some((line) => line.startsWith('#EXT-X-STREAM-INF'))
      if (isMaster && firstChild) {
        const childUrl = withPlexToken(new URL(firstChild, hlsUrl).toString(), plexToken)
        const childRes = await fetch(childUrl, { cache: 'no-store' })
        if (childRes.ok) {
          manifestText = await childRes.text()
          manifestBaseUrl = childUrl
        }
      }

      const rewritten = manifestText
        .split('\n')
        .filter((line) => !line.startsWith('#EXT-X-START'))
        .map((line) => {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) return line
          const absolute = withPlexToken(new URL(trimmed, manifestBaseUrl).toString(), plexToken)
          return `/api/plex-stream?proxyUrl=${encodeURIComponent(absolute)}`
        })
        .join('\n')

      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'private, no-store, max-age=0',
        },
      })
    }

    const fileUrl = buildPartFileUrl(base, partKey, plexToken)
    const response = await proxyBinary(fileUrl, req, plexToken)
    response.headers.set('X-ZombieTV-Stream-Offset-Secs', String(offsetSecs))
    return response
  } catch (err) {
    console.error('Error building Plex stream URL:', err)
    return NextResponse.json(
      { error: 'Failed to build stream', details: String(err) },
      { status: 500 }
    )
  }
}
