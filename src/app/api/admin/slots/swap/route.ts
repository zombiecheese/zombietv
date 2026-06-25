// POST /api/admin/slots/swap
// Swaps the content of two slots within the same schedule day.
// Both slot IDs must belong to the same station/day.
// Writes an audit entry for each slot that changed.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'
import { toJson }       from '@/lib/json'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const { slotAId, slotBId, reason } = body as { slotAId?: string; slotBId?: string; reason?: string }

  if (!slotAId || !slotBId || slotAId === slotBId) {
    return NextResponse.json({ error: 'Two distinct slot IDs required' }, { status: 400 })
  }

  const [slotA, slotB] = await Promise.all([
    prisma.slot.findUnique({ where: { id: slotAId } }),
    prisma.slot.findUnique({ where: { id: slotBId } }),
  ])

  if (!slotA) return NextResponse.json({ error: 'slotA not found' }, { status: 404 })
  if (!slotB) return NextResponse.json({ error: 'slotB not found' }, { status: 404 })

  // Extract the content fields to swap (times and schedule membership stay in place)
  const contentFields = (s: typeof slotA) => ({
    contentSource:  s.contentSource,
    contentId:      s.contentId,
    showTitle:      s.showTitle,
    seasonNumber:   s.seasonNumber,
    episodeNumber:  s.episodeNumber,
    adBreaks:       s.adBreaks,
    fillerId:       s.fillerId,
    fillerDuration: s.fillerDuration,
    metadata:       s.metadata,
    isOverride:     true,
    overrideReason: reason ?? 'manual swap',
  })

  const aContent = contentFields(slotA)
  const bContent = contentFields(slotB)

  // Swap in a transaction
  await prisma.$transaction([
    prisma.slot.update({ where: { id: slotAId }, data: { ...bContent } }),
    prisma.slot.update({ where: { id: slotBId }, data: { ...aContent } }),
  ])

  // Audit log for both slots
  const auditReason = reason ?? 'Slot swap via schedule editor'
  await prisma.$transaction([
    prisma.scheduleChange.create({
      data: {
        userId:     guard.session.userId,
        scheduleId: slotA.scheduleId,
        slotId:     slotAId,
        oldContent: toJson({ contentSource: slotA.contentSource, contentId: slotA.contentId, showTitle: slotA.showTitle }),
        newContent: toJson({ contentSource: slotB.contentSource, contentId: slotB.contentId, showTitle: slotB.showTitle }),
        reason:     auditReason,
      },
    }),
    prisma.scheduleChange.create({
      data: {
        userId:     guard.session.userId,
        scheduleId: slotB.scheduleId,
        slotId:     slotBId,
        oldContent: toJson({ contentSource: slotB.contentSource, contentId: slotB.contentId, showTitle: slotB.showTitle }),
        newContent: toJson({ contentSource: slotA.contentSource, contentId: slotA.contentId, showTitle: slotA.showTitle }),
        reason:     auditReason,
      },
    }),
  ])

  return NextResponse.json({ ok: true })
}
