// GET /api/now/[stationId]
//
// The real-time playback endpoint.
// Returns exactly what a given station is broadcasting right now,
// how far through it we are, and when the next transition happens.
//
// Clients poll this every ~5 seconds and use serverTimeMs to drift-correct
// against their local clock, then seek to startOffsetMs in the media.
//
// Public endpoint — no auth required to watch TV.

import { NextRequest, NextResponse } from 'next/server'
import { getPlaybackState }          from '@/lib/playback'
import type { PlaybackState }        from '@/lib/playback'
import { prisma }                    from '@/lib/db'

export const dynamic = 'force-dynamic'

const LIVE_CACHE_TTL_MS = 1_500
const LIVE_CACHE_MAX_ENTRIES = 64
const livePlaybackCache = new Map<string, { expiresAt: number; state: PlaybackState }>()
const livePlaybackInFlight = new Map<string, Promise<PlaybackState>>()

const STATION_CACHE_TTL_MS = 60_000
let cachedStationIds: { expiresAt: number; ids: Set<string> } | null = null

function pruneLivePlaybackCache(now: number) {
  for (const [key, entry] of livePlaybackCache.entries()) {
    if (entry.expiresAt <= now) livePlaybackCache.delete(key)
  }

  while (livePlaybackCache.size > LIVE_CACHE_MAX_ENTRIES) {
    const oldestKey = livePlaybackCache.keys().next().value
    if (!oldestKey) break
    livePlaybackCache.delete(oldestKey)
  }
}

async function getKnownStationIds(): Promise<Set<string>> {
  const now = Date.now()
  if (cachedStationIds && cachedStationIds.expiresAt > now) return cachedStationIds.ids

  const rows = await prisma.station.findMany({ select: { id: true } })
  const ids = new Set(rows.map((row) => row.id))
  cachedStationIds = {
    ids,
    expiresAt: now + STATION_CACHE_TTL_MS,
  }
  return ids
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stationId: string }> },
) {
  const { stationId } = await params
  const atParam = req.nextUrl.searchParams.get('at')
  const atMs = atParam ? Number(atParam) : undefined

  if (!stationId) {
    return NextResponse.json({ error: 'stationId is required' }, { status: 400 })
  }

  if (atParam && (!Number.isFinite(atMs) || (atMs ?? 0) <= 0)) {
    return NextResponse.json({ error: 'Invalid at timestamp' }, { status: 400 })
  }

  try {
    const knownStationIds = await getKnownStationIds()
    if (!knownStationIds.has(stationId)) {
      return NextResponse.json({ error: 'Unknown stationId' }, { status: 404 })
    }

    const shouldUseCache = !atParam
    const now = Date.now()
    pruneLivePlaybackCache(now)
    if (shouldUseCache) {
      const cached = livePlaybackCache.get(stationId)
      if (cached && cached.expiresAt > now) {
        return NextResponse.json(cached.state, {
          headers: {
            'Cache-Control': 'public, max-age=5, stale-while-revalidate=2',
          },
        })
      }
    }

    const state = shouldUseCache
      ? await (livePlaybackInFlight.get(stationId) ?? (() => {
          const pending = getPlaybackState(stationId, atMs).finally(() => {
            livePlaybackInFlight.delete(stationId)
          })
          livePlaybackInFlight.set(stationId, pending)
          return pending
        })())
      : await getPlaybackState(stationId, atMs)

    if (shouldUseCache) {
      livePlaybackCache.set(stationId, {
        state,
        expiresAt: now + LIVE_CACHE_TTL_MS,
      })
      pruneLivePlaybackCache(now)
    }

    // Set a short cache so CDN / browser doesn't hammer the DB
    // 5 seconds is safe — client re-polls every ~5s anyway
    return NextResponse.json(state, {
      headers: {
        'Cache-Control': 'public, max-age=5, stale-while-revalidate=2',
      },
    })
  } catch (err: any) {
    console.error(`[Playback] Error for station ${stationId}:`, err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
