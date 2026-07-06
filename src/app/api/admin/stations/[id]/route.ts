// GET  /api/admin/stations/[id] — read full station config
// PUT  /api/admin/stations/[id] — update rules, filler pools, holiday overrides

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'
import { toJson, fromJsonObject } from '@/lib/json'
import { validateStationRules } from '@/lib/station-rules-validation'

export const dynamic = 'force-dynamic'

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
    updatedAt:        station.updatedAt.toISOString(),
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))

  // Structural validation — reject malformed rules instead of letting the
  // scheduler silently degrade on them.
  if (body.rules) {
    const problems = validateStationRules(body.rules)
    if (problems.length) {
      return NextResponse.json(
        { error: `Invalid station rules: ${problems.slice(0, 5).join('; ')}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ''}`, problems },
        { status: 400 },
      )
    }
  }

  // Optimistic lock: when the client sends the updatedAt it loaded, refuse to
  // clobber a save made by someone else in the meantime.
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null
  if (expectedUpdatedAt) {
    const current = await prisma.station.findUnique({ where: { id }, select: { updatedAt: true } })
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (current.updatedAt.toISOString() !== expectedUpdatedAt) {
      return NextResponse.json(
        { error: 'This station was modified by someone else since you loaded it. Reload before saving.', conflict: true },
        { status: 409 },
      )
    }
  }

  const updates: Record<string, string> = {}
  if (body.rules)            updates.rules            = toJson(body.rules)
  if (body.fillerPools)      updates.fillerPools      = toJson(body.fillerPools)
  if (body.holidayOverrides) updates.holidayOverrides = toJson(body.holidayOverrides)
  if (body.branding)         updates.branding         = toJson(body.branding)

  const station = await prisma.station.update({
    where: { id },
    data:  updates,
  })

  return NextResponse.json({ ok: true, id: station.id, updatedAt: station.updatedAt.toISOString() })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

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
