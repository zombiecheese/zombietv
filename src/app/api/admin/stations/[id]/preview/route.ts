// GET /api/admin/stations/[id]/preview?date=YYYY-MM-DD
// Dry-run day preview: resolves the effective lineup (windows, date overrides,
// holiday detection, deterministic marathon outcomes) for a station on a
// given date without generating or writing any schedule rows.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { previewStationDay } from '@/lib/scheduler'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const dateStr = new URL(req.url).searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  const preview = await previewStationDay(id, dateStr)
  if (!preview) return NextResponse.json({ error: 'Station not found or invalid date' }, { status: 404 })

  return NextResponse.json(preview)
}
