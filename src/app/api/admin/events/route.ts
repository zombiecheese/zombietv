// GET  /api/admin/events — list upcoming special events
// POST /api/admin/events — create a new special event

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'
import { toJson }       from '@/lib/json'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const events = await prisma.specialEvent.findMany({
    where: { startTime: { gte: new Date() } },
    orderBy: { startTime: 'asc' },
  })

  // Parse the content JSON string for the response
  return NextResponse.json(
    events.map((e) => ({
      ...e,
      content: (() => { try { return JSON.parse(e.content) } catch { return {} } })(),
    })),
  )
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const {
    name, type, stationId, startTime, durationMins,
    priority, replaceSchedule, content,
  } = await req.json().catch(() => ({}))

  const untilContentFinished = Boolean(content?.untilContentFinished)

  if (!name || !type || !startTime || (!untilContentFinished && !durationMins)) {
    return NextResponse.json(
      { error: 'name, type, startTime, and durationMins are required' },
      { status: 400 },
    )
  }

  const event = await prisma.specialEvent.create({
    data: {
      name,
      type,
      stationId:      stationId      ?? null,
      startTime:      new Date(startTime),
      durationMins:   untilContentFinished ? 0 : Number(durationMins),
      priority:       priority        ?? 'medium',
      replaceSchedule: replaceSchedule ?? false,
      content:        toJson(content  ?? {}),
    },
  })

  return NextResponse.json(
    { ...event, content: content ?? {} },
    { status: 201 },
  )
}
