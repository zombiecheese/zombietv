// GET /api/admin/schedule/[stationId]/[date]
// Returns all slots for a station on a given date (YYYY-MM-DD).
// Used by the schedule editor UI.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin }              from '@/lib/admin-guard'
import { prisma }                    from '@/lib/db'
import { fromJsonObject, fromJsonArray } from '@/lib/json'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stationId: string; date: string }> },
) {
  const { stationId, date } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  // Parse as local calendar day, then query by day range. This avoids UTC
  // date-only parsing mismatches with schedules stored at local midnight.
  const start = new Date(year, month - 1, day, 0, 0, 0, 0)
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0)

  const schedule = await prisma.schedule.findFirst({
    where: {
      stationId,
      date: { gte: start, lt: end },
      isActive: true,
    },
    include: { slots: { orderBy: { startTime: 'asc' } } },
    orderBy: { date: 'asc' },
  })

  if (!schedule) {
    return NextResponse.json({ schedule: null, slots: [] })
  }

  const slots = schedule.slots.map((s) => ({
    id:            s.id,
    startTime:     s.startTime.toISOString(),
    durationMins:  s.durationMins,
    contentSource: s.contentSource,
    contentId:     s.contentId,
    showTitle:     s.showTitle,
    seasonNumber:  s.seasonNumber,
    episodeNumber: s.episodeNumber,
    adBreaks:      fromJsonArray(s.adBreaks),
    fillerId:      s.fillerId,
    fillerDuration: s.fillerDuration,
    isOverride:    s.isOverride,
    overrideReason: s.overrideReason,
    metadata:      fromJsonObject(s.metadata),
  }))

  return NextResponse.json({ scheduleId: schedule.id, slots })
}
