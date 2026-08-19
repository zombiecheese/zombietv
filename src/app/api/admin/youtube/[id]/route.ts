// DELETE /api/admin/youtube/[id] — remove a YouTube content entry
// PATCH  /api/admin/youtube/[id] — update title / category

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const { title, category, station, durationMins, dayParts, dateRange, exclusive } = body

  const updated = await prisma.youtubeContent.update({
    where: { id },
    data: {
      ...(title        !== undefined ? { title }        : {}),
      ...(category     !== undefined ? { category }     : {}),
      ...(station      !== undefined ? { station }      : {}),
      ...(durationMins !== undefined ? { durationMins } : {}),
      ...(dayParts     !== undefined ? { dayParts: String(dayParts || '').trim() || null } : {}),
      ...(dateRange    !== undefined ? { dateRange: String(dateRange || '').trim() || null } : {}),
      ...(exclusive    !== undefined ? { exclusive: Boolean(exclusive) } : {}),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  await prisma.youtubeContent.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
