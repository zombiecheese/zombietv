// DELETE /api/admin/events/[id] — remove a special event
// PATCH  /api/admin/events/[id] — update an event

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'
import { toJson }       from '@/lib/json'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const { name, type, stationId, startTime, durationMins, priority, replaceSchedule, content } = body

  const updated = await prisma.specialEvent.update({
    where: { id },
    data: {
      ...(name             !== undefined ? { name }                          : {}),
      ...(type             !== undefined ? { type }                          : {}),
      ...(stationId        !== undefined ? { stationId }                     : {}),
      ...(startTime        !== undefined ? { startTime: new Date(startTime) } : {}),
      ...(durationMins     !== undefined ? { durationMins }                  : {}),
      ...(priority         !== undefined ? { priority }                      : {}),
      ...(replaceSchedule  !== undefined ? { replaceSchedule }               : {}),
      ...(content          !== undefined ? { content: toJson(content) }      : {}),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  await prisma.specialEvent.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
