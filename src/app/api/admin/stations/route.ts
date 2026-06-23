// GET /api/admin/stations — list all stations with parsed config

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin }              from '@/lib/admin-guard'
import { prisma }                    from '@/lib/db'
import { fromJsonObject, toJson }    from '@/lib/json'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const stations = await prisma.station.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] })

  return NextResponse.json(
    stations.map((s) => ({
      id:               s.id,
      name:             s.name,
      sortOrder:        s.sortOrder,
      branding:         fromJsonObject(s.branding),
      rules:            fromJsonObject(s.rules),
      holidayOverrides: fromJsonObject(s.holidayOverrides),
      fillerPools:      fromJsonObject(s.fillerPools),
    })),
  )
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const id = String(body.id ?? '').trim().toLowerCase()
  const name = String(body.name ?? '').trim()

  if (!id || !name) {
    return NextResponse.json({ error: 'id and name are required' }, { status: 400 })
  }

  if (!/^[a-z0-9_-]{2,20}$/.test(id)) {
    return NextResponse.json({ error: 'id must be 2-20 chars: lowercase letters, numbers, _ or -' }, { status: 400 })
  }

  const exists = await prisma.station.findUnique({ where: { id } })
  if (exists) {
    return NextResponse.json({ error: 'Station already exists' }, { status: 409 })
  }

  const station = await prisma.station.create({
    data: {
      id,
      name,
      branding: toJson({ colour_theme: '#2c3e50', logo: '' }),
      rules: toJson({
        allow_genres: '',
        deny_genres: '',
        allow_languages: [],
        deny_languages: [],
        ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 25 },
      }),
      holidayOverrides: toJson({}),
      fillerPools: toJson({ ads: null, music: null, bumpers: null }),
    },
  })

  return NextResponse.json({ ok: true, id: station.id }, { status: 201 })
}
