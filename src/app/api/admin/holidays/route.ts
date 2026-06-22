// GET  /api/admin/holidays — list holiday overrides
// POST /api/admin/holidays — upsert a holiday override

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const rows = await prisma.holidayOverride.findMany({
    where: { consumedAt: null },
    orderBy: [{ holidayName: 'asc' }, { stationId: 'asc' }],
  })

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const {
    id, holidayName, stationId,
    replaceSchedule, adFree, contentPriority, onceOffEvent,
  } = await req.json().catch(() => ({}))

  if (!holidayName) {
    return NextResponse.json({ error: 'holidayName required' }, { status: 400 })
  }

  // Normalise contentPriority: accept array or comma string
  const priority = Array.isArray(contentPriority)
    ? contentPriority.join(',')
    : (contentPriority ?? '')
  const legacyYear = new Date().getFullYear()

  const payload = {
    holidayName,
    year: legacyYear,
    stationId: stationId ?? null,
    replaceSchedule: replaceSchedule ?? true,
    adFree: adFree ?? false,
    contentPriority: priority,
    onceOffEvent: Boolean(onceOffEvent),
  }

  const existing = id
    ? await prisma.holidayOverride.findUnique({ where: { id: String(id) } })
    : await prisma.holidayOverride.findFirst({
        where: {
          holidayName,
          consumedAt: null,
          stationId: stationId ?? null,
        },
      })

  const row = existing
    ? await prisma.holidayOverride.update({
        where: { id: existing.id },
        data: {
          holidayName,
          year: legacyYear,
          stationId: stationId ?? null,
          replaceSchedule: replaceSchedule ?? true,
          adFree: adFree ?? false,
          contentPriority: priority,
          onceOffEvent: Boolean(onceOffEvent),
        },
      })
    : await prisma.holidayOverride.create({ data: payload })

  return NextResponse.json(row, { status: 201 })
}
