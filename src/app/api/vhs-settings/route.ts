// GET  /api/vhs-settings  — returns current global VHS effect settings
// POST /api/vhs-settings  — admin-only, updates one or more settings

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'

export const dynamic = 'force-dynamic'
import { sessionOptions, SessionData } from '@/lib/session'
import { prisma }       from '@/lib/db'
import { toJson, fromJson } from '@/lib/json'
import { DEFAULT_VHS_SETTINGS, type VHSSettings } from '@/lib/vhs-defaults'

const NUMBER_VHS_KEYS = [
  'scanlines',
  'noise',
  'chromaticAberration',
  'vignette',
  'crtCurvature',
  'flicker',
] as const

const BOOLEAN_VHS_KEYS = ['debugOverlayEnabled'] as const
const VHS_KEYS = [...NUMBER_VHS_KEYS, ...BOOLEAN_VHS_KEYS] as const

export async function GET() {
  const rows = await prisma.adminPreference.findMany({
    where: { stationId: null, settingKey: { in: [...VHS_KEYS] } },
  })

  const settings: VHSSettings = { ...DEFAULT_VHS_SETTINGS }
  for (const row of rows) {
    if (NUMBER_VHS_KEYS.includes(row.settingKey as typeof NUMBER_VHS_KEYS[number])) {
      const numericKey = row.settingKey as typeof NUMBER_VHS_KEYS[number]
      const parsed = fromJson<number>(row.settingValue, DEFAULT_VHS_SETTINGS[numericKey])
      settings[numericKey] = parsed
    }
    if (BOOLEAN_VHS_KEYS.includes(row.settingKey as typeof BOOLEAN_VHS_KEYS[number])) {
      const booleanKey = row.settingKey as typeof BOOLEAN_VHS_KEYS[number]
      const parsed = fromJson<boolean>(row.settingValue, DEFAULT_VHS_SETTINGS[booleanKey])
      settings[booleanKey] = parsed
    }
  }

  return NextResponse.json(settings, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  })
}

export async function POST(req: NextRequest) {
  const res     = new NextResponse()
  const session = await getIronSession<SessionData>(req, res, sessionOptions)

  if (!session.isLoggedIn || !session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  for (const key of NUMBER_VHS_KEYS) {
    if (key in body && typeof body[key] === 'number') {
      const value = Math.min(1, Math.max(0, body[key]))
      // Prisma requires a defined value in composite unique keys.
      // We use the sentinel string '__global__' in the where clause and
      // store null in the actual column so queries still filter correctly.
      const existing = await prisma.adminPreference.findFirst({
        where: { stationId: null, settingKey: key },
      })
      if (existing) {
        await prisma.adminPreference.update({
          where: { id: existing.id },
          data:  { settingValue: toJson(value) },
        })
      } else {
        await prisma.adminPreference.create({
          data: { stationId: null, settingKey: key, settingValue: toJson(value) },
        })
      }
    }
  }

  for (const key of BOOLEAN_VHS_KEYS) {
    if (key in body && typeof body[key] === 'boolean') {
      const value = body[key]
      const existing = await prisma.adminPreference.findFirst({
        where: { stationId: null, settingKey: key },
      })
      if (existing) {
        await prisma.adminPreference.update({
          where: { id: existing.id },
          data:  { settingValue: toJson(value) },
        })
      } else {
        await prisma.adminPreference.create({
          data: { stationId: null, settingKey: key, settingValue: toJson(value) },
        })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
