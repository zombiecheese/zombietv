// GET  /api/app-settings — public, returns current app name
// POST /api/app-settings — admin only, updates app name

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, type SessionData } from '@/lib/session'
import {
  getAppName,
  saveAppName,
  getSchedulerHorizonDays,
  getSchedulerIntervalHours,
  saveSchedulerHorizonDays,
  saveSchedulerIntervalHours,
} from '@/lib/app-settings'
import { restartScheduler } from '@/lib/scheduler'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [appName, schedulerHorizonDays, schedulerIntervalHours] = await Promise.all([
    getAppName(),
    getSchedulerHorizonDays(),
    getSchedulerIntervalHours(),
  ])
  return NextResponse.json({ appName, schedulerHorizonDays, schedulerIntervalHours }, {
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

  const result: Record<string, unknown> = { ok: true }
  let schedulerSettingsChanged = false

  if (body?.appName !== undefined) {
    if (typeof body.appName !== 'string') {
      return NextResponse.json({ error: 'appName must be a string.' }, { status: 400 })
    }
    result.appName = await saveAppName(body.appName)
  }

  if (body?.schedulerHorizonDays !== undefined) {
    result.schedulerHorizonDays = await saveSchedulerHorizonDays(body.schedulerHorizonDays)
    schedulerSettingsChanged = true
  }

  if (body?.schedulerIntervalHours !== undefined) {
    result.schedulerIntervalHours = await saveSchedulerIntervalHours(body.schedulerIntervalHours)
    schedulerSettingsChanged = true
  }

  if (!result.appName && !result.schedulerHorizonDays && !result.schedulerIntervalHours) {
    return NextResponse.json({ error: 'No valid settings provided.' }, { status: 400 })
  }

  if (schedulerSettingsChanged) {
    restartScheduler()
  }

  return NextResponse.json(result)
}
