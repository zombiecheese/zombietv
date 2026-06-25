// POST /api/admin/stations/order — persist channel ordering.
// Body: { ids: string[] } in the desired display order. Each station's
// sortOrder is set to its index, controlling both the Station Rules list and
// the viewer EPG.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids) ? body.ids.map((x: unknown) => String(x)) : []
  if (!ids.length) {
    return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
  }

  await prisma.$transaction(
    ids.map((id: string, index: number) =>
      prisma.station.update({ where: { id }, data: { sortOrder: index } }),
    ),
  )

  return NextResponse.json({ ok: true })
}
