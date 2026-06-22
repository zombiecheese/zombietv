// POST /api/scheduler/run
// Manually triggers a scheduler run.
// Admin-only. Used by the admin portal's "Regenerate Schedule" button.

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'
import { prisma } from '@/lib/db'
import { isSchedulerRunning, getSchedulerRunStatus } from '@/lib/scheduler'
import { getSchedulerHorizonDays } from '@/lib/app-settings'

export const dynamic = 'force-dynamic'
import { sessionOptions, SessionData } from '@/lib/session'
import { runScheduler }              from '@/lib/scheduler'

type ManualRunTracker = {
  startedAt: string
  horizonDays: number
  stationId: string | null
  forceRegenerate: boolean
} | null

let lastManualRun: ManualRunTracker = null

function startOfLocalDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0)
}

function addDaysLocal(value: Date, days: number): Date {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

export async function POST(req: NextRequest) {
  // Auth check — must be an admin
  const res     = new NextResponse()
  const session = await getIronSession<SessionData>(req, res, sessionOptions)

  if (!session.isLoggedIn || !session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const defaultHorizon = await getSchedulerHorizonDays()
  const horizonDays = Number(body?.horizonDays) || defaultHorizon
  const stationId = String(body?.stationId ?? '').trim().toLowerCase() || null
  const forceRegenerate = body?.forceRegenerate !== false

  lastManualRun = {
    startedAt: new Date().toISOString(),
    horizonDays,
    stationId,
    forceRegenerate,
  }

  // Run in background — don't await (can take a while for large libraries)
  runScheduler(horizonDays, stationId, { forceRegenerate }).catch((err) => {
    console.error('[Scheduler] Manual run error:', err)
  })

  return NextResponse.json({
    ok:          true,
    message:     stationId
      ? `${forceRegenerate ? 'Scheduler regeneration' : 'Scheduler run'} triggered for ${horizonDays} days for ${stationId}. Check status below.`
      : `${forceRegenerate ? 'Scheduler regeneration' : 'Scheduler run'} triggered for ${horizonDays} days. Check status below.`,
    startedAt:   new Date().toISOString(),
    status:      await getSchedulerRunStatus(),
  })
}

// GET /api/scheduler/run — returns status info
export async function GET(req: NextRequest) {
  const res     = new NextResponse()
  const session = await getIronSession<SessionData>(req, res, sessionOptions)

  if (!session.isLoggedIn || !session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const requestedStationId = String(req.nextUrl.searchParams.get('stationId') ?? '').trim().toLowerCase() || null
  const defaultHorizonGet = await getSchedulerHorizonDays()
  const requestedHorizon = Number(req.nextUrl.searchParams.get('horizonDays')) || defaultHorizonGet
  const horizonDays = Math.max(1, Math.min(365, requestedHorizon))

  const scopeStationId = requestedStationId
  const now = new Date()
  const windowStart = startOfLocalDay(now)
  const windowEnd = addDaysLocal(windowStart, horizonDays)

  const stationsInScope = scopeStationId
    ? 1
    : await prisma.station.count()

  const whereInWindow = {
    isActive: true,
    date: { gte: windowStart, lt: windowEnd },
    ...(scopeStationId ? { stationId: scopeStationId } : {}),
  }

  const scheduledInWindow = await prisma.schedule.count({ where: whereInWindow })
  const grouped = await prisma.schedule.groupBy({
    by: ['stationId'],
    where: whereInWindow,
    _count: { _all: true },
  })

  const totalTargetDays = Math.max(1, horizonDays * Math.max(1, stationsInScope))
  const progressPercent = Math.max(0, Math.min(100, Math.round((scheduledInWindow / totalTargetDays) * 100)))

  const totalScheduled = await prisma.schedule.count({ where: { isActive: true } })

  return NextResponse.json({
    isRunning: isSchedulerRunning(),
    status: await getSchedulerRunStatus(),
    scope: {
      stationId: scopeStationId,
      horizonDays,
      stationsInScope,
    },
    coverage: {
      scheduledDays: scheduledInWindow,
      targetDays: totalTargetDays,
      progressPercent,
      byStation: grouped.map((row) => ({ stationId: row.stationId, days: row._count._all })),
    },
    lastManualRun,
    scheduledDays:      totalScheduled,
    totalScheduledDays: totalScheduled,
    checkedAt:          new Date().toISOString(),
  })
}
