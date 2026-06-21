import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, SessionData } from '@/lib/session'

export const dynamic = 'force-dynamic'

function normalizeClientSessionId(raw: string | null, fallbackUserId: string): string {
  if (raw && /^[A-Za-z0-9_-]{8,80}$/.test(raw)) return raw
  return `zombietv-${fallbackUserId}`
}

function isPrivateIp(value: string): boolean {
  const ip = value.trim()
  if (!ip) return false
  if (ip === '::1' || ip === '127.0.0.1') return true
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true
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

export async function POST(req: NextRequest) {
  const sessionResponse = new NextResponse()
  const session = await getIronSession<SessionData>(req, sessionResponse, sessionOptions)

  if (!session.isLoggedIn || !session.plexServerUrl || !session.plexToken) {
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
  const location = inferPlaybackLocation(req)
  const clientSessionId = normalizeClientSessionId(requestedClientSessionId, session.userId || 'viewer')
  const base = session.plexServerUrl.replace(/\/$/, '')

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
    'X-Plex-Token': session.plexToken,
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
