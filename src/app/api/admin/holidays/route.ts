// GET  /api/admin/holidays — list all HolidayOverride rows for current + next year
// POST /api/admin/holidays — upsert a holiday override

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const thisYear = new Date().getFullYear()

  const rows = await prisma.holidayOverride.findMany({
    where: { year: { gte: thisYear } },
    orderBy: [{ year: 'asc' }, { holidayName: 'asc' }],
  })

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const {
    id, holidayName, year, stationId,
    replaceSchedule, adFree, contentPriority,
  } = await req.json().catch(() => ({}))

  if (!holidayName || !year) {
    return NextResponse.json({ error: 'holidayName and year required' }, { status: 400 })
  }

  // Normalise contentPriority: accept array or comma string
  const priority = Array.isArray(contentPriority)
    ? contentPriority.join(',')
    : (contentPriority ?? '')

  const payload = {
    holidayName,
    year: Number(year),
    stationId: stationId ?? null,
    replaceSchedule: replaceSchedule ?? true,
    adFree: adFree ?? false,
    contentPriority: priority,
  }

  const existing = id
    ? await prisma.holidayOverride.findUnique({ where: { id: String(id) } })
    : await prisma.holidayOverride.findFirst({
        where: {
          holidayName,
          year: Number(year),
          stationId: stationId ?? null,
        },
      })

  const row = existing
    ? await prisma.holidayOverride.update({
        where: { id: existing.id },
        data: {
          holidayName,
          year: Number(year),
          stationId: stationId ?? null,
          replaceSchedule: replaceSchedule ?? true,
          adFree: adFree ?? false,
          contentPriority: priority,
        },
      })
    : await prisma.holidayOverride.create({ data: payload })

  return NextResponse.json(row, { status: 201 })
}
