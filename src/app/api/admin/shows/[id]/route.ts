// PATCH  /api/admin/shows/[id] — reset episode pointer or toggle completed
// DELETE /api/admin/shows/[id] — remove the show's timeslot lock entirely

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const { nextSeason, nextEpisode, isCompleted, airedWeekday, airedTime } =
    await req.json().catch(() => ({}))

  const updated = await prisma.showProgress.update({
    where: { id },
    data: {
      ...(nextSeason   !== undefined ? { nextSeason }   : {}),
      ...(nextEpisode  !== undefined ? { nextEpisode }  : {}),
      ...(isCompleted  !== undefined ? { isCompleted }  : {}),
      ...(airedWeekday !== undefined ? { airedWeekday } : {}),
      ...(airedTime    !== undefined ? { airedTime }    : {}),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  await prisma.showProgress.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
