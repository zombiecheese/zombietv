// GET   /api/admin/shows         — list all ShowProgress records
// PATCH /api/admin/shows/[id]   — reset episode pointer or mark completed

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const url       = new URL(req.url)
  const stationId = url.searchParams.get('stationId')

  const rows = await prisma.showProgress.findMany({
    where: stationId ? { stationId } : {},
    orderBy: [{ stationId: 'asc' }, { showTitle: 'asc' }],
  })

  return NextResponse.json(rows)
}
