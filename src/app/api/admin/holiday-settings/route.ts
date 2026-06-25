import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { loadHolidaySettings, renameHolidayReferences, saveHolidaySettings } from '@/lib/holidays'

export const dynamic = 'force-dynamic'

interface HolidaySettingPayload {
  id?: string
  name: string
  label: string
  startMonth: number
  startDay: number
  endMonth: number
  endDay: number
  enabled?: boolean
}

function normalizePayload(body: any): HolidaySettingPayload | null {
  const name = String(body?.name ?? '').trim().toLowerCase()
  const label = String(body?.label ?? '').trim()
  const startMonth = Number(body?.startMonth)
  const startDay = Number(body?.startDay)
  const endMonth = Number(body?.endMonth)
  const endDay = Number(body?.endDay)
  if (!name || !label) return null
  if (![startMonth, startDay, endMonth, endDay].every((n) => Number.isFinite(n) && n >= 1)) return null
  return {
    id: String(body?.id ?? '').trim() || randomUUID(),
    name,
    label,
    startMonth,
    startDay,
    endMonth,
    endDay,
    enabled: body?.enabled !== false,
  }
}

export async function GET(req: NextRequest) {
  try {
    const guard = await requireAdmin(req)
    if (!guard.ok) return guard.response

    const settings = await loadHolidaySettings()
    return NextResponse.json({ settings })
  } catch (err: any) {
    console.error('[HolidaySettings] GET failed:', err)
    return NextResponse.json({ error: String(err?.message ?? err ?? 'Holiday settings load failed') }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireAdmin(req)
    if (!guard.ok) return guard.response

    const body = await req.json().catch(() => ({}))
    const nextSetting = normalizePayload(body)
    if (!nextSetting) {
      return NextResponse.json({ error: 'name, label, and date range fields are required' }, { status: 400 })
    }

    const settings = await loadHolidaySettings()
    const index = settings.findIndex((item) => item.id === String(body?.id ?? nextSetting.id))
    const existing = index >= 0 ? settings[index] : null

    if (existing && existing.name !== nextSetting.name) {
      await renameHolidayReferences(existing.name, nextSetting.name)
    }

    if (index >= 0) settings[index] = nextSetting as any
    else settings.push(nextSetting as any)

    await saveHolidaySettings(settings as any)
    return NextResponse.json({ ok: true, setting: nextSetting }, { status: 201 })
  } catch (err: any) {
    console.error('[HolidaySettings] POST failed:', err)
    return NextResponse.json({ error: String(err?.message ?? err ?? 'Holiday settings save failed') }, { status: 500 })
  }
}