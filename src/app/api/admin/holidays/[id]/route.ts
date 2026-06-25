// DELETE /api/admin/holidays/[id] — remove a holiday override row

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  await prisma.holidayOverride.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
