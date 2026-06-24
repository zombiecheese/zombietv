import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, type SessionData } from '@/lib/session'
import { getCatalogPlaybackServerUrl } from '@/lib/plex-catalog'
import { getPlexPlaybackConnectionForServer, isPrivateHost } from '@/lib/plex-auth'

// Mark this route as dynamic since it uses request.headers
export const dynamic = 'force-dynamic'

export interface PlexTrack {
  id:       string   // Stream ID used to select the track (Plex streamIdentifier or id)
  index:    number
  language: string   // e.g. "English", "Japanese"
  languageCode: string // ISO 639-1 e.g. "en", "ja"
  title:    string   // e.g. "English (AAC 5.1)", "Commentary"
  selected: boolean
}

export interface TracksResponse {
  audio:     PlexTrack[]
  subtitles: PlexTrack[]
}

async function resolvePlexCredentials(session: SessionData) {
  if (session.isLoggedIn && session.plexToken) {
    const catalogServerUrl = await getCatalogPlaybackServerUrl(session.plexServerUrl)
    if (!catalogServerUrl) return null
    const connection = await getPlexPlaybackConnectionForServer(session.plexToken, catalogServerUrl, {
      allowLanFallback: false,
    }).catch(() => null)
    return {
      plexToken: connection?.token ?? session.plexToken,
      plexServerUrl: connection?.url ?? catalogServerUrl,
    }
  }
  return null
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

export async function GET(req: NextRequest) {
  try {
    const sessionResponse = new NextResponse()
    const session = await getIronSession<SessionData>(req, sessionResponse, sessionOptions)

    const { searchParams } = new URL(req.url)
    const contentId = searchParams.get('contentId')

    if (!contentId) {
      return NextResponse.json({ error: 'Missing contentId' }, { status: 400 })
    }

    const creds = await resolvePlexCredentials(session)
    if (!creds) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    let base = creds.plexServerUrl.replace(/\/$/, '')
    let plexToken = creds.plexToken
    if (isLanBaseUrl(base)) {
      const remoteConnection = await getPlexPlaybackConnectionForServer(session.plexToken, creds.plexServerUrl, {
        allowLanFallback: false,
      }).catch(() => null)
      if (!remoteConnection?.url) {
        return NextResponse.json(
          { error: 'Playback requires a remote Plex endpoint. LAN/private Plex URLs are disabled for playback.' },
          { status: 502 },
        )
      }
      base = remoteConnection.url.replace(/\/$/, '')
      plexToken = remoteConnection.token
    }
    let metadataUrl = `${base}/library/metadata/${contentId}?X-Plex-Token=${plexToken}`

    let res: Response
    try {
      res = await fetch(metadataUrl, { cache: 'no-store' })
    } catch (err) {
      if (!isPlexNetworkError(err)) throw err
      const refreshedConnection = await getPlexPlaybackConnectionForServer(session.plexToken, creds.plexServerUrl, {
        allowLanFallback: false,
      }).catch(() => null)
      const refreshedBase = refreshedConnection?.url?.replace(/\/$/, '') ?? ''
      if (!refreshedBase || refreshedBase === base) throw err
      plexToken = refreshedConnection?.token ?? plexToken
      base = refreshedBase
      metadataUrl = `${base}/library/metadata/${contentId}?X-Plex-Token=${plexToken}`
      res = await fetch(metadataUrl, { cache: 'no-store' })
    }

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch Plex metadata' }, { status: 502 })
    }

    const xml = await res.text()

    // Parse Stream elements from Plex XML
    // streamType 1 = video, 2 = audio, 3 = subtitle
    const streamRegex = /<Stream\s([^/]*?)(?:\/>|>)/g
    const audio: PlexTrack[] = []
    const subtitles: PlexTrack[] = []

    let match: RegExpExecArray | null
    while ((match = streamRegex.exec(xml)) !== null) {
      const attrs = match[1]

      const getAttr = (name: string) => {
        const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'))
        return m ? m[1] : ''
      }

      const streamType = getAttr('streamType')
      if (streamType !== '2' && streamType !== '3') continue

      const id           = getAttr('id')
      const index        = parseInt(getAttr('index') || '0', 10)
      const language     = getAttr('language') || getAttr('languageTag') || 'Unknown'
      const languageCode = getAttr('languageCode') || getAttr('languageTag') || ''
      const displayTitle = getAttr('displayTitle') || ''
      const title        = getAttr('title') || ''
      const selected     = getAttr('selected') === '1'
      const codec        = getAttr('codec') || ''
      const channels     = getAttr('channels') || ''

      // Build a human-readable label
      let label = displayTitle || language
      if (!displayTitle) {
        if (streamType === '2' && codec) {
          label = `${language} (${codec.toUpperCase()}${channels ? ' ' + channels + 'ch' : ''})`
        } else if (title && title !== language) {
          label = `${language} — ${title}`
        }
      }

      const track: PlexTrack = {
        id,
        index,
        language,
        languageCode,
        title: label,
        selected,
      }

      if (streamType === '2') audio.push(track)
      else subtitles.push(track)
    }

    // Always prepend a "None" option for subtitles
    if (subtitles.length > 0) {
      const noneSelected = subtitles.every((s) => !s.selected)
      subtitles.unshift({
        id: '0',
        index: -1,
        language: 'None',
        languageCode: '',
        title: 'None',
        selected: noneSelected,
      })
    }

    const result: TracksResponse = { audio, subtitles }
    return NextResponse.json(result)
  } catch (err) {
    console.error('[/api/plex-stream/tracks]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
