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

export const dynamic = 'force-dynamic'

const LIVE_CACHE_TTL_MS = 1_500
const livePlaybackCache = new Map<string, { expiresAt: number; state: PlaybackState }>()

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
    const shouldUseCache = !atParam
    if (shouldUseCache) {
      const cached = livePlaybackCache.get(stationId)
      if (cached && cached.expiresAt > Date.now()) {
        return NextResponse.json(cached.state, {
          headers: {
            'Cache-Control': 'public, max-age=5, stale-while-revalidate=2',
          },
        })
      }
    }

    const state = await getPlaybackState(stationId, atMs)
    if (shouldUseCache) {
      livePlaybackCache.set(stationId, {
        state,
        expiresAt: Date.now() + LIVE_CACHE_TTL_MS,
      })
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
