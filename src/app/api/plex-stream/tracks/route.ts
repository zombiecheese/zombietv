import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, type SessionData } from '@/lib/session'
import { prisma } from '@/lib/db'
import { fromJsonObject } from '@/lib/json'

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
  if (session.plexToken && session.plexServerUrl) {
    return { plexToken: session.plexToken, plexServerUrl: session.plexServerUrl }
  }
  // Fall back to first admin user with Plex credentials
  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { preferences: true },
  })
  for (const admin of admins) {
    const prefs = fromJsonObject<Record<string, string>>(admin.preferences)
    if (prefs?.plexToken && prefs?.plexServerUrl) {
      return { plexToken: prefs.plexToken, plexServerUrl: prefs.plexServerUrl }
    }
  }
  return null
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

    const base = creds.plexServerUrl.replace(/\/$/, '')
    const metadataUrl = `${base}/library/metadata/${contentId}?X-Plex-Token=${creds.plexToken}`
    const res = await fetch(metadataUrl, { cache: 'no-store' })

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
