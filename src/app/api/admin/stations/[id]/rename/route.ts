// POST /api/admin/stations/[id]/rename — rename a station's id and/or display name.
//
// Renaming the display name is a simple update. Renaming the id is more involved
// because it is the primary key referenced by schedules (FK) and by several
// loose stationId columns (showProgress, specialEvent, holidayOverride,
// adminPreference) plus youtubeContent.station. We create the new station,
// re-point every reference, then delete the old row — all in one transaction.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const newId = body.newId == null ? null : String(body.newId).trim().toLowerCase()
  const newName = body.newName == null ? null : String(body.newName).trim()

  const station = await prisma.station.findUnique({ where: { id } })
  if (!station) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const idChanged = newId != null && newId !== id
  const finalName = newName != null && newName.length ? newName : station.name

  // ── Validate ────────────────────────────────────────────────────────────
  if (newName != null && !newName.length) {
    return NextResponse.json({ error: 'Display name cannot be empty' }, { status: 400 })
  }
  if (idChanged && !/^[a-z0-9_-]{2,20}$/.test(newId!)) {
    return NextResponse.json({ error: 'id must be 2-20 chars: lowercase letters, numbers, _ or -' }, { status: 400 })
  }
  if (idChanged) {
    const clash = await prisma.station.findUnique({ where: { id: newId! } })
    if (clash) return NextResponse.json({ error: 'A station with that id already exists' }, { status: 409 })
  }
  if (finalName !== station.name) {
    const nameClash = await prisma.station.findFirst({ where: { name: finalName, NOT: { id } } })
    if (nameClash) return NextResponse.json({ error: 'A station with that name already exists' }, { status: 409 })
  }

  // ── Name-only rename ──────────────────────────────────────────────────────
  if (!idChanged) {
    if (finalName === station.name) {
      return NextResponse.json({ ok: true, id, name: station.name })
    }
    const updated = await prisma.station.update({ where: { id }, data: { name: finalName } })
    return NextResponse.json({ ok: true, id: updated.id, name: updated.name })
  }

  // ── Id rename (re-point all references) ───────────────────────────────────
  const target = newId!
  await prisma.$transaction(async (tx) => {
    // Free the unique name on the old row so the new row can take it.
    await tx.station.update({ where: { id }, data: { name: `${station.name}__migrating_${Date.now()}` } })

    await tx.station.create({
      data: {
        id:               target,
        name:             finalName,
        branding:         station.branding,
        rules:            station.rules,
        holidayOverrides: station.holidayOverrides,
        fillerPools:      station.fillerPools,
      },
    })

    await tx.schedule.updateMany({ where: { stationId: id }, data: { stationId: target } })
    await tx.showProgress.updateMany({ where: { stationId: id }, data: { stationId: target } })
    await tx.specialEvent.updateMany({ where: { stationId: id }, data: { stationId: target } })
    await tx.holidayOverride.updateMany({ where: { stationId: id }, data: { stationId: target } })
    await tx.adminPreference.updateMany({ where: { stationId: id }, data: { stationId: target } })
    await tx.youtubeContent.updateMany({ where: { station: id }, data: { station: target } })

    await tx.station.delete({ where: { id } })
  })

  return NextResponse.json({ ok: true, id: target, name: finalName })
}
