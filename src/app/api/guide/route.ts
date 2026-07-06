// GET /api/guide — aggregated listings for the guide channel.
// One request returns every station plus its next ~3 hours of programming,
// with a short server-side cache so all guide-channel viewers share the work.
// Public endpoint — the guide channel is watchable without auth.

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fromJsonObject } from '@/lib/json'
import { buildEpgSlots } from '@/lib/epg'

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 60_000
let cached: { expiresAt: number; body: unknown } | null = null

export interface GuideRowPayload {
  id: string
  name: string
  colour: string
  entries: Array<{ title: string; startMs: number; endMs: number }>
}

function halfHourFloor(ms: number): number {
  const d = new Date(ms)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30)
  return d.getTime()
}

export async function GET() {
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.body, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    })
  }

  const from = new Date(halfHourFloor(now))
  const to = new Date(from.getTime() + 3 * 60 * 60_000)

  const stations = await prisma.station.findMany({
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, branding: true },
  })

  const rows: GuideRowPayload[] = await Promise.all(
    stations.map(async (s) => {
      const branding = fromJsonObject<Record<string, unknown>>(s.branding)
      const entries = await buildEpgSlots(s.id, from, to).catch(() => [])
      return {
        id: s.id,
        name: s.name,
        colour: String(branding.colour_theme ?? '#2c3e50'),
        entries: entries.map((slot) => ({
          title: slot.title,
          startMs: new Date(slot.startTime).getTime(),
          endMs: new Date(slot.endTime).getTime(),
        })),
      }
    }),
  )

  const body = { fromMs: from.getTime(), toMs: to.getTime(), rows }
  cached = { body, expiresAt: now + CACHE_TTL_MS }

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  })
}
