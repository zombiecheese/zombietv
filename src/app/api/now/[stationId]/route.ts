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

export const dynamic = 'force-dynamic'

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
    const state = await getPlaybackState(stationId, atMs)

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
