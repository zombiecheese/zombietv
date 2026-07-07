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

  // Cache at finer precision so nearby configured locations do not collapse
  // into the same response (~11m resolution at the equator).
  const key = `${latitude.toFixed(4)},${longitude.toFixed(4)}`
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
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,is_day',
    hourly: 'temperature_2m,weather_code,precipitation_probability,precipitation,cloud_cover,visibility',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,daylight_duration,uv_index_max,moon_phase,moonrise,moonset',
    timezone: 'auto',
    forecast_days: '7',
  })

  const marineParams = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: 'wave_height,wind_wave_height,swell_wave_height,sea_surface_temperature',
    timezone: 'auto',
    forecast_days: '2',
  })

  try {
    const [forecastRes, marineRes] = await Promise.allSettled([
      fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(`https://marine-api.open-meteo.com/v1/marine?${marineParams}`, {
        signal: AbortSignal.timeout(10_000),
      }),
    ])

    if (forecastRes.status !== 'fulfilled' || !forecastRes.value.ok) {
      const status = forecastRes.status === 'fulfilled' ? forecastRes.value.status : 502
      return NextResponse.json({ error: `Weather upstream HTTP ${status}` }, { status: 502 })
    }

    const forecastBody = await forecastRes.value.json()
    let marineBody: unknown = null
    if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
      marineBody = await marineRes.value.json()
    }

    const body = {
      forecast: forecastBody,
      marine: marineBody,
      source: {
        provider: 'open-meteo',
      },
    }

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
