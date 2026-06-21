import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const stationId = typeof body?.stationId === 'string' && body.stationId.trim()
    ? body.stationId.trim()
    : null

  const result = await prisma.$transaction(async (tx) => {
    const schedules = await tx.schedule.findMany({
      where: stationId ? { stationId } : undefined,
      select: { id: true },
    })

    const scheduleIds = schedules.map((s) => s.id)
    if (!scheduleIds.length) {
      return {
        stationId,
        removedSchedules: 0,
        removedSlots: 0,
        removedSlotLinks: 0,
      }
    }

    const slots = await tx.slot.findMany({
      where: { scheduleId: { in: scheduleIds } },
      select: { id: true },
    })
    const slotIds = slots.map((s) => s.id)

    const removedSlotLinks = slotIds.length
      ? await tx.slotMediaItem.deleteMany({ where: { slotId: { in: slotIds } } })
      : { count: 0 }
    const removedSlots = await tx.slot.deleteMany({ where: { scheduleId: { in: scheduleIds } } })
    const removedSchedules = await tx.schedule.deleteMany({ where: { id: { in: scheduleIds } } })

    return {
      stationId,
      removedSchedules: removedSchedules.count,
      removedSlots: removedSlots.count,
      removedSlotLinks: removedSlotLinks.count,
    }
  })

  return NextResponse.json({ ok: true, ...result })
}