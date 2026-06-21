// PATCH /api/admin/slots/[id] — override a single slot
// DELETE /api/admin/slots/[id] — soft-delete (set isOverride + blank content)

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
  const {
    contentSource, contentId, showTitle, seasonNumber, episodeNumber,
    fillerId, fillerDuration, reason,
  } = body

  // Read old slot for audit log
  const oldSlot = await prisma.slot.findUnique({ where: { id } })
  if (!oldSlot) return NextResponse.json({ error: 'Slot not found' }, { status: 404 })

  const updated = await prisma.slot.update({
    where: { id },
    data: {
      contentSource:  contentSource  ?? oldSlot.contentSource,
      contentId:      contentId      ?? oldSlot.contentId,
      showTitle:      showTitle      ?? oldSlot.showTitle,
      seasonNumber:   seasonNumber   ?? oldSlot.seasonNumber,
      episodeNumber:  episodeNumber  ?? oldSlot.episodeNumber,
      fillerId:       fillerId       ?? oldSlot.fillerId,
      fillerDuration: fillerDuration ?? oldSlot.fillerDuration,
      isOverride:     true,
      overrideReason: reason ?? 'manual',
    },
  })

  // Write audit entry
  await prisma.scheduleChange.create({
    data: {
      userId:     guard.session.userId,
      scheduleId: oldSlot.scheduleId,
      slotId:     id,
      oldContent: toJson({
        contentSource: oldSlot.contentSource,
        contentId:     oldSlot.contentId,
        showTitle:     oldSlot.showTitle,
      }),
      newContent: toJson({
        contentSource: updated.contentSource,
        contentId:     updated.contentId,
        showTitle:     updated.showTitle,
      }),
      reason: reason ?? 'Manual override via admin portal',
    },
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const slot = await prisma.slot.findUnique({ where: { id } })
  if (!slot) return NextResponse.json({ error: 'Slot not found' }, { status: 404 })

  // Don't actually delete — mark as override with empty content so the
  // playback engine falls back to filler for this window.
  await prisma.slot.update({
    where: { id },
    data: {
      contentSource:  'youtube',
      contentId:      null,
      isOverride:     true,
      overrideReason: 'deleted',
    },
  })

  await prisma.scheduleChange.create({
    data: {
      userId:     guard.session.userId,
      scheduleId: slot.scheduleId,
      slotId:     id,
      oldContent: toJson({ contentSource: slot.contentSource, contentId: slot.contentId }),
      newContent: toJson({ contentSource: 'youtube', contentId: null }),
      reason:     'Slot removed via admin portal',
    },
  })

  return NextResponse.json({ ok: true })
}
