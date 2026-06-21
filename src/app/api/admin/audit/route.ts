// GET /api/admin/audit?page=1&limit=50&stationId=zbc
// Returns paginated ScheduleChange audit log entries.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin }              from '@/lib/admin-guard'
import { prisma }                    from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const url   = new URL(req.url)
  const page  = Math.max(1, Number(url.searchParams.get('page')  ?? 1))
  const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 50))
  const skip  = (page - 1) * limit

  const [total, entries] = await Promise.all([
    prisma.scheduleChange.count(),
    prisma.scheduleChange.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { user: { select: { email: true, username: true } } },
    }),
  ])

  return NextResponse.json({
    total,
    page,
    limit,
    entries: entries.map((e) => {
      // e.user is non-null (userId FK is required) but guard defensively for the type
      const userName = e.user?.username ?? e.user?.email ?? 'unknown'

      // oldContent / newContent are nullable JSON strings
      const parseJsonField = (raw: string | null | undefined): Record<string, unknown> => {
        if (!raw) return {}
        try { return JSON.parse(raw) as Record<string, unknown> }
        catch (_err) { return {} }
      }

      return {
        id:         e.id,
        scheduleId: e.scheduleId,
        slotId:     e.slotId,
        reason:     e.reason,
        createdAt:  e.createdAt.toISOString(),
        user:       userName,
        oldContent: parseJsonField(e.oldContent),
        newContent: parseJsonField(e.newContent),
      }
    }),
  })
}
