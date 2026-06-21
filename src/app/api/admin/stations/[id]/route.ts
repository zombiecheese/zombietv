// GET  /api/admin/stations/[id] — read full station config
// PUT  /api/admin/stations/[id] — update rules, filler pools, holiday overrides

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'
import { toJson, fromJsonObject } from '@/lib/json'

export const dynamic = 'force-dynamic'
const BASE_STATION_IDS = new Set(['stn', 'zbc', 'nnwk', 'seven', 'nine', 'ten'])

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const station = await prisma.station.findUnique({ where: { id } })
  if (!station) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    id:               station.id,
    name:             station.name,
    branding:         fromJsonObject(station.branding),
    rules:            fromJsonObject(station.rules),
    holidayOverrides: fromJsonObject(station.holidayOverrides),
    fillerPools:      fromJsonObject(station.fillerPools),
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))

  const updates: Record<string, string> = {}
  if (body.rules)            updates.rules            = toJson(body.rules)
  if (body.fillerPools)      updates.fillerPools      = toJson(body.fillerPools)
  if (body.holidayOverrides) updates.holidayOverrides = toJson(body.holidayOverrides)
  if (body.branding)         updates.branding         = toJson(body.branding)

  const station = await prisma.station.update({
    where: { id },
    data:  updates,
  })

  return NextResponse.json({ ok: true, id: station.id })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  if (BASE_STATION_IDS.has(id)) {
    return NextResponse.json({ error: 'Base stations cannot be deleted' }, { status: 400 })
  }

  const station = await prisma.station.findUnique({ where: { id } })
  if (!station) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const scheduleIds = (await prisma.schedule.findMany({
    where: { stationId: id },
    select: { id: true },
  })).map((s) => s.id)

  await prisma.$transaction(async (tx) => {
    if (scheduleIds.length) {
      await tx.slotMediaItem.deleteMany({ where: { slotId: { in: (await tx.slot.findMany({ where: { scheduleId: { in: scheduleIds } }, select: { id: true } })).map((s) => s.id) } } })
      await tx.slot.deleteMany({ where: { scheduleId: { in: scheduleIds } } })
      await tx.schedule.deleteMany({ where: { id: { in: scheduleIds } } })
    }
    await tx.holidayOverride.deleteMany({ where: { stationId: id } })
    await tx.specialEvent.deleteMany({ where: { stationId: id } })
    await tx.youtubeContent.deleteMany({ where: { station: id } })
    await tx.showProgress.deleteMany({ where: { stationId: id } })
    await tx.adminPreference.deleteMany({ where: { stationId: id } })
    await tx.station.delete({ where: { id } })
  })

  return NextResponse.json({ ok: true, id })
}
