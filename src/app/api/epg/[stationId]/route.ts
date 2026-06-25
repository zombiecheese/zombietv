// GET /api/epg/[stationId]?from=ISO&hours=48
// Returns a flat array of slot summaries for the EPG grid.
// Public endpoint — no auth required.

import { NextRequest, NextResponse } from 'next/server'
import { prisma }               from '@/lib/db'

export const dynamic = 'force-dynamic'
import { fromJsonObject, fromJsonArray } from '@/lib/json'
import { addDays, addHours, startOfHour } from 'date-fns'

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
  isLive:        boolean
}

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

  // Pull slots by absolute time range instead of schedule.day boundaries.
  // This keeps EPG aligned with playback even when local/UTC day edges differ.
  const allSlots = await prisma.slot.findMany({
    where: {
      startTime: {
        gte: addDays(from, -1),
        lt: addDays(to, 1),
      },
      schedule: {
        stationId,
        isActive: true,
      },
    },
    orderBy: { startTime: 'asc' },
  })

  const epgSlots: EPGSlot[] = []

  for (let index = 0; index < allSlots.length; index++) {
    const slot = allSlots[index]
    const nextSlot = allSlots[index + 1]
    const meta = fromJsonObject<Record<string, any>>(slot.metadata)
    const adBreaks = fromJsonArray<{ durationMins?: number }>(slot.adBreaks)
    const adBreakMins = adBreaks.reduce((sum, ab) => sum + Number(ab?.durationMins ?? 0), 0)
    const explicitShowInEpg = typeof meta.showInEpg === 'boolean' ? meta.showInEpg : null
    const isAutoYoutubeFill = slot.contentSource === 'youtube' && !slot.isOverride
    const showInEpg = explicitShowInEpg ?? !isAutoYoutubeFill

    const slotStartMs = slot.startTime.getTime()
    const slotEndRawMs = slotStartMs + (slot.durationMins + adBreakMins + (slot.fillerDuration ?? 0)) * 60_000
    const nextStartMs = nextSlot ? nextSlot.startTime.getTime() : null
    const slotEndMs = nextStartMs == null ? slotEndRawMs : Math.min(slotEndRawMs, nextStartMs)
    const effectiveDurationMins = Math.max(0, Math.round((slotEndMs - slotStartMs) / 60_000))

    // Keep any slot that overlaps the requested window.
    if (slotStartMs >= to.getTime() || slotEndMs <= from.getTime()) continue
    if (!showInEpg) continue

    const isLiveNewsSlot = String(meta.reason ?? '') === 'news_live_window'
    const liveTitle = `LIVE: ${stationId.toUpperCase()} News`

    // Main scheduled content segment.
    epgSlots.push({
      id:            slot.id,
      startTime:     slot.startTime.toISOString(),
      endTime:       new Date(slotEndMs).toISOString(),
      durationMins:  effectiveDurationMins,
      title:         isLiveNewsSlot ? liveTitle : (meta.title ?? slot.showTitle ?? slot.contentSource ?? 'Programme'),
      showTitle:     isLiveNewsSlot ? liveTitle : slot.showTitle,
      seasonNumber:  slot.seasonNumber,
      episodeNumber: slot.episodeNumber,
      contentSource: slot.contentSource,
      isOverride:    slot.isOverride,
      overrideReason: slot.overrideReason,
      inAdBreak:     adBreaks.length > 0,
      isLive:        isLiveNewsSlot,
    })
  }

  return NextResponse.json(epgSlots, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  })
}
