// GET /api/guide/promos — auto-populated promo rotation for the guide channel.
// For each station's now-airing programme, resolves a promo video by taking
// the top YouTube search result for the title ("<title> trailer"). Lookups
// run server-side (viewer IPs stay private) and are cached aggressively so
// the whole guide audience shares a handful of searches per programme.
// Public endpoint — the guide channel is watchable without auth.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { buildEpgSlots } from '@/lib/epg'

export const dynamic = 'force-dynamic'

const PAYLOAD_TTL_MS = 5 * 60_000
const SEARCH_HIT_TTL_MS = 12 * 60 * 60_000
const SEARCH_MISS_TTL_MS = 30 * 60_000
const SEARCH_CACHE_MAX = 300

let cachedPayload: { expiresAt: number; body: unknown } | null = null
const searchCache = new Map<string, { videoId: string | null; expiresAt: number }>()

// Programme titles that are generic filler — not worth a promo search.
const GENERIC_TITLES = new Set([
  'filler', 'late night programming', 'paid program', 'closedown', 'off air',
  'infomercials', 'programme', 'continuous programming', 'weather centre',
  'programme guide', 'live stream', 'web channel',
])

export interface GuidePromoPayload {
  stationId: string
  stationName: string
  channelNumber: number
  title: string
  videoId: string | null
  nextTitle: string | null
  nextStartMs: number | null
}

function isPromoWorthy(title: string): boolean {
  const key = title.trim().toLowerCase()
  if (!key || GENERIC_TITLES.has(key)) return false
  if (key.startsWith('live:')) return false
  return true
}

// Top search result scrape: fetch the results page and take the first
// videoId in the payload. No API key required; failures degrade to null and
// the client falls back to the configured promo video / clock card.
async function searchYoutubeVideoId(query: string): Promise<string | null> {
  const key = query.toLowerCase()
  const now = Date.now()
  const hit = searchCache.get(key)
  if (hit && hit.expiresAt > now) return hit.videoId

  let videoId: string | null = null
  try {
    const params = new URLSearchParams({ search_query: query, sp: 'EgIQAQ==' }) // videos only
    const res = await fetch(`https://www.youtube.com/results?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept-Language': 'en',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (res.ok) {
      const html = await res.text()
      const m = html.match(/"videoId":"([\w-]{11})"/)
      videoId = m ? m[1] : null
    }
  } catch {
    videoId = null
  }

  // Prune expired entries, then cap size.
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    for (const [k, v] of searchCache) {
      if (v.expiresAt <= now) searchCache.delete(k)
    }
    while (searchCache.size >= SEARCH_CACHE_MAX) {
      const oldest = searchCache.keys().next().value
      if (!oldest) break
      searchCache.delete(oldest)
    }
  }
  searchCache.set(key, {
    videoId,
    expiresAt: now + (videoId ? SEARCH_HIT_TTL_MS : SEARCH_MISS_TTL_MS),
  })
  return videoId
}

export async function GET() {
  const now = Date.now()
  if (cachedPayload && cachedPayload.expiresAt > now) {
    return NextResponse.json(cachedPayload.body, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    })
  }

  const from = new Date(now - 60_000)
  const to = new Date(now + 3 * 60 * 60_000)

  const stations = await prisma.station.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true },
  })

  const promos: GuidePromoPayload[] = (
    await Promise.all(
      stations.map(async (s, index): Promise<GuidePromoPayload | null> => {
        const entries = await buildEpgSlots(s.id, from, to).catch(() => [])
        const current = entries.find((e) => {
          const startMs = new Date(e.startTime).getTime()
          const endMs = new Date(e.endTime).getTime()
          return startMs <= now && now < endMs
        })
        if (!current || !isPromoWorthy(current.title)) return null

        const currentEndMs = new Date(current.endTime).getTime()
        const next = entries.find((e) => new Date(e.startTime).getTime() >= currentEndMs - 60_000
          && e.title !== current.title)

        // Prefer the series name over an episode title for a broader search.
        const searchName = (current.showTitle ?? current.title).trim()
        const videoId = await searchYoutubeVideoId(`${searchName} trailer`)

        return {
          stationId: s.id,
          stationName: s.name,
          channelNumber: index + 1,
          title: current.title,
          videoId,
          nextTitle: next?.title ?? null,
          nextStartMs: next ? new Date(next.startTime).getTime() : null,
        }
      }),
    )
  ).filter((p): p is GuidePromoPayload => p !== null)

  const body = { promos }
  cachedPayload = { body, expiresAt: now + PAYLOAD_TTL_MS }

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, max-age=120' },
  })
}
