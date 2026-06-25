import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import {
  addHolidayTag,
  getHolidayTagMap,
  getHolidayTaggedKeys,
  listHolidayTaggedItems,
  removeHolidayTag,
  searchCatalogMedia,
} from '@/lib/plex-catalog'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const holidayName = String(url.searchParams.get('holidayName') || '').trim()
  const query = String(url.searchParams.get('q') || '').trim()
  const typeRaw = String(url.searchParams.get('type') || 'all').toLowerCase()
  const type = typeRaw === 'movie' || typeRaw === 'show' ? typeRaw : 'all'
  const library = String(url.searchParams.get('library') || '').trim()
  const limit = Number(url.searchParams.get('limit') || 25)

  if (!holidayName) {
    const tagMap = await getHolidayTagMap()
    return NextResponse.json({ tagMap })
  }

  const [taggedKeys, taggedItems, results] = await Promise.all([
    getHolidayTaggedKeys(holidayName),
    listHolidayTaggedItems(holidayName),
    query.length >= 2 ? searchCatalogMedia(query, type, limit, library) : Promise.resolve([]),
  ])

  return NextResponse.json({ holidayName, taggedKeys, taggedItems, results })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const holidayName = String(body?.holidayName || '').trim()
  const plexKey = String(body?.plexKey || '').trim()

  if (!holidayName || !plexKey) {
    return NextResponse.json({ error: 'holidayName and plexKey are required' }, { status: 400 })
  }

  await addHolidayTag(holidayName, plexKey)
  const taggedItems = await listHolidayTaggedItems(holidayName)
  return NextResponse.json({ ok: true, holidayName, taggedItems })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const holidayName = String(body?.holidayName || '').trim()
  const plexKey = String(body?.plexKey || '').trim()
  const plexKeys = Array.isArray(body?.plexKeys)
    ? body.plexKeys.map((key: unknown) => String(key || '').trim()).filter(Boolean)
    : []

  if (!holidayName || (!plexKey && !plexKeys.length)) {
    return NextResponse.json({ error: 'holidayName and plexKey or plexKeys are required' }, { status: 400 })
  }

  if (plexKeys.length) {
    await Promise.all(plexKeys.map((key: string) => removeHolidayTag(holidayName, key)))
  } else {
    await removeHolidayTag(holidayName, plexKey)
  }
  const taggedItems = await listHolidayTaggedItems(holidayName)
  return NextResponse.json({ ok: true, holidayName, taggedItems })
}