// GET /api/epg/[stationId]?from=ISO&hours=48
// Returns a flat array of slot summaries for the EPG grid.
// Public endpoint — no auth required.

import { NextRequest, NextResponse } from 'next/server'
import { prisma }               from '@/lib/db'

export const dynamic = 'force-dynamic'
import { fromJsonObject, fromJsonArray } from '@/lib/json'
import { addDays, addHours, startOfDay, startOfHour } from 'date-fns'

export interface EPGSlot {
  id:            string
  startTime:     string   // ISO
  endTime:       string   // ISO
  durationMins:  number
  title:         string
  showTitle:     string | null
  seasonNumber:  number | null
  episodeNumber: number | null
  contentSource: string
  isOverride:    boolean
  overrideReason: string | null
  inAdBreak:     boolean  // true if this slot has ad breaks
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stationId: string }> },
) {
  const { stationId } = await params
  const url    = new URL(req.url)
  const hours  = Math.min(Number(url.searchParams.get('hours') ?? 48), 48)
  const fromRaw = url.searchParams.get('from')
  const from   = fromRaw ? new Date(fromRaw) : startOfHour(new Date())
  const to     = addHours(from, hours)
  const fromDayStart = startOfDay(from)
  const toDayStart = startOfDay(to)

  // Pull schedules that overlap the requested window
  const schedules = await prisma.schedule.findMany({
    where: {
      stationId,
      isActive: true,
      date: {
        // Include the previous day so slots that started before `from`
        // but are still on-air are present in the EPG window.
        gte: addDays(fromDayStart, -1),
        lte: toDayStart,
      },
    },
    include: {
      slots: {
        orderBy: { startTime: 'asc' },
      },
    },
    orderBy: { date: 'asc' },
  })

  const allSlots = schedules
    .flatMap((schedule) => schedule.slots)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())

  const epgSlots: EPGSlot[] = []

  for (let index = 0; index < allSlots.length; index++) {
    const slot = allSlots[index]
    const nextSlot = allSlots[index + 1]
      const meta     = fromJsonObject<Record<string, any>>(slot.metadata)
      const adBreaks = fromJsonArray(slot.adBreaks)
      const showInEpg = meta.showInEpg !== false
      const slotStartMs = slot.startTime.getTime()
      const slotEndRawMs = slotStartMs + slot.durationMins * 60_000 + (slot.fillerDuration ?? 0) * 60_000
      const nextStartMs = nextSlot ? nextSlot.startTime.getTime() : null
      const slotEndMs = nextStartMs == null ? slotEndRawMs : Math.min(slotEndRawMs, nextStartMs)
      const effectiveDurationMins = Math.max(0, Math.round((slotEndMs - slotStartMs) / 60_000))

      // Keep any slot that overlaps the requested window.
      if (slotStartMs >= to.getTime() || slotEndMs <= from.getTime()) continue
      if (!showInEpg) continue

      // Main scheduled content segment.
      epgSlots.push({
        id:            slot.id,
        startTime:     slot.startTime.toISOString(),
        endTime:       new Date(slotEndMs).toISOString(),
        durationMins:  effectiveDurationMins,
        title:         meta.title ?? slot.showTitle ?? slot.contentSource ?? 'Programme',
        showTitle:     slot.showTitle,
        seasonNumber:  slot.seasonNumber,
        episodeNumber: slot.episodeNumber,
        contentSource: slot.contentSource,
        isOverride:    slot.isOverride,
        overrideReason: slot.overrideReason,
        inAdBreak:     adBreaks.length > 0,
      })
  }

  return NextResponse.json(epgSlots, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  })
}
