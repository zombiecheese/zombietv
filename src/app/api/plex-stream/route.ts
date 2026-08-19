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
import { getCatalogPlaybackServerUrl } from '@/lib/plex-catalog'
import { getPlexPlaybackConnectionForServer, getPlexRemoteOrigins, isPrivateHost } from '@/lib/plex-auth'

const REMOTE_ORIGINS_TTL_MS = 60_000
const MAX_REMOTE_ORIGIN_CACHE_ENTRIES = 64
const remoteOriginsCache = new Map<string, { expiresAt: number; origins: string[] }>()

async function resolvePlexCredentials(session: SessionData): Promise<{ plexServerUrl: string; plexToken: string } | null> {
  if (session.isLoggedIn && session.plexToken) {
    const catalogServerUrl = await getCatalogPlaybackServerUrl(session.plexServerUrl)
    if (!catalogServerUrl) return null
    const connection = await getPlexPlaybackConnectionForServer(session.plexToken, catalogServerUrl, {
      allowLanFallback: false,
    }).catch(() => null)
    return {
      plexServerUrl: connection?.url ?? catalogServerUrl,
      plexToken: connection?.token ?? session.plexToken,
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

// Strips the Plex token before a URL is embedded in a manifest/proxy link
// that gets sent to the client. The token is re-attached server-side (via
// withPlexToken) only when we ourselves dereference the proxy link.
function withoutPlexToken(url: string): string {
  const next = new URL(url)
  next.searchParams.delete('X-Plex-Token')
  return next.toString()
}

function normalizeClientSessionId(raw: string | null, fallbackUserId: string): string {
  if (raw && /^[A-Za-z0-9_-]{8,80}$/.test(raw)) return raw
  return `zombietv-${fallbackUserId}`
}

function isPlexNetworkError(err: unknown): boolean {
  const code = (err as { cause?: { code?: string } })?.cause?.code
  return code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT'
}

function isLanBaseUrl(url: string): boolean {
  try {
    return isPrivateHost(new URL(url).hostname)
  } catch {
    return false
  }
}

async function resolveAllowedRemoteOrigins(
  plexToken: string,
  fallbackBase: string,
  options: { forceRefresh?: boolean } = {},
): Promise<Set<string>> {
  const now = Date.now()
  const allowed = new Set<string>()
  try {
    const fallbackOrigin = new URL(fallbackBase).origin
    if (!isPrivateHost(new URL(fallbackBase).hostname)) {
      allowed.add(fallbackOrigin)
    }
  } catch {
    // Ignore invalid fallback URL.
  }

  if (!options.forceRefresh) {
    const cached = remoteOriginsCache.get(plexToken)
    if (cached && cached.expiresAt > now) {
      for (const origin of cached.origins) allowed.add(origin)
      return allowed
    }
    if (cached && cached.expiresAt <= now) {
      remoteOriginsCache.delete(plexToken)
    }
  }

  let discovered: string[] = []
  try {
    discovered = await getPlexRemoteOrigins(plexToken)
    for (const origin of discovered) allowed.add(origin)
  } catch {
    // If discovery fails, keep any non-private fallback origin.
  }

  if (discovered.length) {
    if (remoteOriginsCache.size >= MAX_REMOTE_ORIGIN_CACHE_ENTRIES) {
      const oldest = remoteOriginsCache.keys().next().value
      if (oldest) remoteOriginsCache.delete(oldest)
    }
    remoteOriginsCache.set(plexToken, {
      expiresAt: now + REMOTE_ORIGINS_TTL_MS,
      origins: discovered,
    })
  }

  return allowed
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
    // Direct-stream (remux) the video track, but never direct play the raw
    // file: browsers need the HLS pipeline, and audio may need transcoding.
    directPlay: '0',
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
    // Declaring the Chrome platform makes Plex apply its built-in browser
    // client profile: h264 video direct-streams, while AC3/EAC3/DTS audio is
    // transcoded to AAC/MP3 (browsers cannot decode those codecs).
    'X-Plex-Platform': 'Chrome',
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
        const absolute = withoutPlexToken(new URL(trimmed, urlWithToken).toString())
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

    let plexServerUrl = creds.plexServerUrl
    let plexToken = creds.plexToken
    const clientSessionId = normalizeClientSessionId(requestedClientSessionId, session.userId || 'viewer')
    // Playback is proxied through the Plex relay (server-side), which is always a
    // remote/WAN connection from Plex's perspective. Never treat it as LAN, since
    // the viewer's own network has no bearing on the ZombieTV → Plex link.
    const playbackLocation: 'lan' | 'wan' = 'wan'

    let base = plexServerUrl.replace(/\/$/, '')
    if (isLanBaseUrl(base)) {
      const remoteConnection = await getPlexPlaybackConnectionForServer(session.plexToken, plexServerUrl, {
        allowLanFallback: false,
      }).catch(() => null)
      if (!remoteConnection?.url) {
        return NextResponse.json(
          { error: 'Playback requires a remote Plex endpoint. LAN/private Plex URLs are disabled for playback.' },
          { status: 502 },
        )
      }
      plexServerUrl = remoteConnection.url
      plexToken = remoteConnection.token
      base = plexServerUrl.replace(/\/$/, '')
    }

    if (proxyUrl) {
      const target = decodeURIComponent(proxyUrl)
      const targetOrigin = new URL(target).origin
      let allowedOrigins = await resolveAllowedRemoteOrigins(plexToken, base)
      if (!allowedOrigins.has(targetOrigin)) {
        // Retry once with a forced refresh to tolerate endpoint rotation.
        allowedOrigins = await resolveAllowedRemoteOrigins(plexToken, base, { forceRefresh: true })
      }
      if (!allowedOrigins.has(targetOrigin)) {
        return NextResponse.json({ error: 'Invalid proxy target' }, { status: 400 })
      }
      return await proxyBinary(target, req, plexToken)
    }
    
    // First, fetch media metadata to resolve the concrete file part key.
    let metadataUrl = `${base}/library/metadata/${contentId}?X-Plex-Token=${plexToken}`
    let metadataRes: Response
    try {
      metadataRes = await fetch(metadataUrl, { cache: 'no-store' })
    } catch (err) {
      if (!isPlexNetworkError(err)) throw err
      const refreshedConnection = await getPlexPlaybackConnectionForServer(session.plexToken, plexServerUrl, {
        allowLanFallback: false,
      }).catch(() => null)
      const refreshedBase = refreshedConnection?.url?.replace(/\/$/, '') ?? ''
      if (!refreshedBase || refreshedBase === base) throw err
      plexToken = refreshedConnection?.token ?? plexToken
      plexServerUrl = refreshedConnection?.url ?? plexServerUrl
      base = refreshedBase
      metadataUrl = `${base}/library/metadata/${contentId}?X-Plex-Token=${plexToken}`
      metadataRes = await fetch(metadataUrl, { cache: 'no-store' })
    }

    if (!metadataRes.ok && (metadataRes.status === 401 || metadataRes.status === 403)) {
      // Endpoint or token-scoped route may have rotated; refresh once and retry.
      const refreshedConnection = await getPlexPlaybackConnectionForServer(session.plexToken, plexServerUrl, {
        allowLanFallback: false,
      }).catch(() => null)
      const refreshedBase = refreshedConnection?.url?.replace(/\/$/, '') ?? ''
      if (refreshedBase && refreshedBase !== base) {
        plexToken = refreshedConnection?.token ?? plexToken
        plexServerUrl = refreshedConnection?.url ?? plexServerUrl
        base = refreshedBase
        metadataUrl = `${base}/library/metadata/${contentId}?X-Plex-Token=${plexToken}`
        metadataRes = await fetch(metadataUrl, { cache: 'no-store' })
      }
    }
    
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
          const absolute = withoutPlexToken(new URL(trimmed, manifestBaseUrl).toString())
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
