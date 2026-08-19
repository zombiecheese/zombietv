// GET /api/weather/tile?kind=base|radar&z=..&x=..&y=..&ts=..
// Map tile proxy for the weather channel radar page.
//   base  → CARTO dark basemap (OpenStreetMap data)
//   radar → RainViewer precipitation radar frame (ts = frame unix time from
//           /api/weather/radar)
// Tiles are cached in memory so a looping radar animation costs at most one
// upstream fetch per tile per frame across all viewers.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const BASE_TTL_MS = 24 * 60 * 60_000
const RADAR_TTL_MS = 60 * 60_000
const CACHE_MAX_ENTRIES = 600
const MIN_ZOOM = 3
const MAX_ZOOM_BASE = 11
const MAX_ZOOM_RADAR = 7 // RainViewer hard limit — higher zooms return an error tile

const cache = new Map<string, { expiresAt: number; body: Buffer; contentType: string }>()

function pruneCache(now: number) {
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value
    if (!oldest) break
    cache.delete(oldest)
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const z = Number(url.searchParams.get('z'))
  const x = Number(url.searchParams.get('x'))
  const y = Number(url.searchParams.get('y'))
  const ts = Number(url.searchParams.get('ts') ?? 0)

  if (kind !== 'base' && kind !== 'radar') {
    return NextResponse.json({ error: 'kind must be base or radar' }, { status: 400 })
  }
  const maxZoom = kind === 'radar' ? MAX_ZOOM_RADAR : MAX_ZOOM_BASE
  if (!Number.isInteger(z) || z < MIN_ZOOM || z > maxZoom) {
    return NextResponse.json({ error: 'Invalid zoom' }, { status: 400 })
  }
  const max = 2 ** z
  if (!Number.isInteger(x) || x < 0 || x >= max || !Number.isInteger(y) || y < 0 || y >= max) {
    return NextResponse.json({ error: 'Invalid tile coordinates' }, { status: 400 })
  }
  if (kind === 'radar' && (!Number.isInteger(ts) || ts <= 0)) {
    return NextResponse.json({ error: 'radar requires a frame ts' }, { status: 400 })
  }

  const key = `${kind}:${kind === 'radar' ? ts : 0}:${z}:${x}:${y}`
  const now = Date.now()
  pruneCache(now)

  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) {
    return new NextResponse(new Uint8Array(cached.body), {
      headers: { 'Content-Type': cached.contentType, 'Cache-Control': 'public, max-age=3600' },
    })
  }

  const upstream = kind === 'base'
    // dark_all: dark basemap with place labels — reads like a 90s radar map.
    ? `https://basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`
    // Color scheme 4 (TWC-style), smoothed, with snow rendering.
    : `https://tilecache.rainviewer.com/v2/radar/${ts}/256/${z}/${x}/${y}/4/1_1.png`

  try {
    const res = await fetch(upstream, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'zombietv-weather-channel/1.0' },
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Tile upstream HTTP ${res.status}` }, { status: 502 })
    }
    const body = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type') ?? 'image/png'
    cache.set(key, {
      body,
      contentType,
      expiresAt: now + (kind === 'base' ? BASE_TTL_MS : RADAR_TTL_MS),
    })
    return new NextResponse(new Uint8Array(body), {
      headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' },
    })
  } catch {
    if (cached) {
      return new NextResponse(new Uint8Array(cached.body), {
        headers: { 'Content-Type': cached.contentType },
      })
    }
    return NextResponse.json({ error: 'Tile service unavailable' }, { status: 502 })
  }
}
