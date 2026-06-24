import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, SessionData } from '@/lib/session'
import { getCatalogPlaybackServerUrl } from '@/lib/plex-catalog'
import { getPlexPlaybackConnectionForServer, isPrivateHost } from '@/lib/plex-auth'

export const dynamic = 'force-dynamic'

function normalizeClientSessionId(raw: string | null, fallbackUserId: string): string {
  if (raw && /^[A-Za-z0-9_-]{8,80}$/.test(raw)) return raw
  return `zombietv-${fallbackUserId}`
}

function isLanBaseUrl(url: string): boolean {
  try {
    return isPrivateHost(new URL(url).hostname)
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const sessionResponse = new NextResponse()
  const session = await getIronSession<SessionData>(req, sessionResponse, sessionOptions)

  if (!session.isLoggedIn || !session.plexToken) {
    return NextResponse.json({ error: 'Sign in with Plex to report playback progress.' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const contentId = typeof body?.contentId === 'string' ? body.contentId.trim() : ''
  const rawOffsetMs = Number(body?.offsetMs ?? 0)
  const rawDurationMs = Number(body?.durationMs ?? 0)
  const rawState = String(body?.state ?? 'playing').toLowerCase()
  const requestedClientSessionId = typeof body?.clientSessionId === 'string' ? body.clientSessionId : null

  if (!contentId) {
    return NextResponse.json({ error: 'contentId is required' }, { status: 400 })
  }

  const time = Number.isFinite(rawOffsetMs) ? Math.max(0, Math.floor(rawOffsetMs)) : 0
  const duration = Number.isFinite(rawDurationMs) ? Math.max(0, Math.floor(rawDurationMs)) : 0
  const state = ['playing', 'paused', 'stopped', 'buffering'].includes(rawState) ? rawState : 'playing'
  // Keep timeline reporting aligned with stream playback policy: playback is
  // always treated as WAN/remote and never LAN.
  const location: 'lan' | 'wan' = 'wan'
  const clientSessionId = normalizeClientSessionId(requestedClientSessionId, session.userId || 'viewer')
  const catalogServerUrl = await getCatalogPlaybackServerUrl(session.plexServerUrl)
  if (!catalogServerUrl) {
    return NextResponse.json({ error: 'Playback server is not configured.' }, { status: 502 })
  }

  const playbackConnection = await getPlexPlaybackConnectionForServer(session.plexToken, catalogServerUrl, {
    allowLanFallback: false,
  }).catch(() => null)
  if (!playbackConnection?.url) {
    return NextResponse.json({ error: 'Playback server is not reachable for this Plex account.' }, { status: 502 })
  }

  const plexToken = playbackConnection.token

  let base = playbackConnection.url.replace(/\/$/, '')
  if (isLanBaseUrl(base)) {
    const remoteConnection = await getPlexPlaybackConnectionForServer(session.plexToken, playbackConnection.url, {
      allowLanFallback: false,
    }).catch(() => null)
    if (!remoteConnection?.url) {
      return NextResponse.json(
        { error: 'Playback requires a remote Plex endpoint. LAN/private Plex URLs are disabled for playback.' },
        { status: 502 },
      )
    }
    base = remoteConnection.url.replace(/\/$/, '')
  }

  const params = new URLSearchParams({
    ratingKey: contentId,
    key: `/library/metadata/${contentId}`,
    state,
    time: String(time),
    duration: String(duration),
    playMethod: 'transcode',
    hasMDE: '1',
    protocol: 'hls',
    location,
    'X-Plex-Product': 'ZombieTV',
    'X-Plex-Device-Name': 'ZombieTV Web',
    'X-Plex-Device': 'Web Browser',
    'X-Plex-Model': 'ZombieTV',
    'X-Plex-Platform': 'Web',
    'X-Plex-Client-Identifier': clientSessionId,
    'X-Plex-Session-Identifier': clientSessionId,
    'X-Plex-Token': plexToken,
  })

  const timelineUrl = `${base}/:/timeline?${params.toString()}`

  try {
    const upstream = await fetch(timelineUrl, { method: 'GET', cache: 'no-store' })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Failed to relay timeline update to Plex.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Timeline relay failed.' }, { status: 502 })
  }
}
