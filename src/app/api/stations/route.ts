// GET /api/stations — public station list for viewer + pickers

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fromJsonObject } from '@/lib/json'

export const dynamic = 'force-dynamic'

export async function GET() {
  const stations = await prisma.station.findMany({ orderBy: { id: 'asc' } })

  return NextResponse.json(
    stations.map((s) => ({
      id: s.id,
      name: s.name,
      branding: fromJsonObject<Record<string, unknown>>(s.branding),
    })),
  )
}
