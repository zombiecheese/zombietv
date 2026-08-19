// GET /api/epg/[stationId]?from=ISO&hours=48
// Returns a flat array of slot summaries for the EPG grid.
// Public endpoint — no auth required.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
import { startOfHour, addHours } from 'date-fns'
import { buildEpgSlots } from '@/lib/epg'
export type { EPGSlot } from '@/lib/epg'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stationId: string }> },
) {
  const { stationId } = await params
  const url    = new URL(req.url)
  const hours  = Math.min(Number(url.searchParams.get('hours') ?? 48), 48)
  const fromMsRaw = url.searchParams.get('fromMs')
  const fromRaw = url.searchParams.get('from')
  const fromMs = fromMsRaw ? Number(fromMsRaw) : NaN
  const from = Number.isFinite(fromMs)
    ? new Date(fromMs)
    : (fromRaw ? new Date(fromRaw) : startOfHour(new Date()))

  if (!Number.isFinite(from.getTime())) {
    return NextResponse.json({ error: 'Invalid from timestamp' }, { status: 400 })
  }

  const to     = addHours(from, hours)

  // Listing construction (including non-standard channel synthesis) lives in
  // lib/epg so /api/guide can aggregate the same data.
  const epgSlots = await buildEpgSlots(stationId, from, to)

  return NextResponse.json(epgSlots, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  })
}
