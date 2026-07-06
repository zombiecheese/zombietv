// GET /api/weather?latitude=..&longitude=..
// Server-side Open-Meteo proxy with a short cache so every viewer of the
// weather channel shares one upstream request (and viewer IPs stay private).
// Public endpoint — the weather channel is watchable without auth.

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 10 * 60_000
const CACHE_MAX_ENTRIES = 32
const cache = new Map<string, { expiresAt: number; body: unknown }>()

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
  const latitude = Number(url.searchParams.get('latitude'))
  const longitude = Number(url.searchParams.get('longitude'))

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: 'Valid latitude and longitude are required' }, { status: 400 })
  }

  // Coarse cache key: ~1km resolution is plenty for broadcast weather.
  const key = `${latitude.toFixed(2)},${longitude.toFixed(2)}`
  const now = Date.now()
  pruneCache(now)

  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.body, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  }

  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7',
  })

  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Weather upstream HTTP ${res.status}` }, { status: 502 })
    }
    const body = await res.json()
    cache.set(key, { body, expiresAt: now + CACHE_TTL_MS })
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, max-age=300' },
    })
  } catch {
    // Serve stale data when the upstream is briefly unavailable.
    if (cached) return NextResponse.json(cached.body)
    return NextResponse.json({ error: 'Weather service unavailable' }, { status: 502 })
  }
}
