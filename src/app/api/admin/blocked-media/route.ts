import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import {
  addBlockedPlexKey,
  getBlockedPlexKeys,
  listBlockedCatalogItems,
  removeBlockedPlexKey,
  searchCatalogMedia,
} from '@/lib/plex-catalog'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const query = (url.searchParams.get('q') || '').trim()
  const typeRaw = (url.searchParams.get('type') || 'all').toLowerCase()
  const type = typeRaw === 'movie' || typeRaw === 'show' ? typeRaw : 'all'
  const limit = Number(url.searchParams.get('limit') || 25)

  const [blockedKeys, blockedItems, results] = await Promise.all([
    getBlockedPlexKeys(),
    listBlockedCatalogItems(),
    query.length >= 2 ? searchCatalogMedia(query, type, limit) : Promise.resolve([]),
  ])

  return NextResponse.json({ blockedKeys, blockedItems, results })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const plexKey = String(body?.plexKey || '').trim()
  if (!plexKey) {
    return NextResponse.json({ error: 'plexKey is required' }, { status: 400 })
  }

  await addBlockedPlexKey(plexKey)
  const blockedItems = await listBlockedCatalogItems()
  return NextResponse.json({ ok: true, blockedItems })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const plexKey = String(body?.plexKey || '').trim()
  if (!plexKey) {
    return NextResponse.json({ error: 'plexKey is required' }, { status: 400 })
  }

  await removeBlockedPlexKey(plexKey)
  const blockedItems = await listBlockedCatalogItems()
  return NextResponse.json({ ok: true, blockedItems })
}