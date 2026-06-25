import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { deleteHolidayReferences, loadHolidaySettings, saveHolidaySettings } from '@/lib/holidays'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const settings = await loadHolidaySettings()
  const target = settings.find((item) => item.id === id)
  if (!target) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  await deleteHolidayReferences(target.name)
  await saveHolidaySettings(settings.filter((item) => item.id !== id))
  return NextResponse.json({ ok: true })
}