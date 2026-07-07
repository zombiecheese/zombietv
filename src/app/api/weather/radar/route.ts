// GET /api/weather/radar
// RainViewer radar frame metadata proxy (no API key required).
// Returns recent past radar frame timestamps; tiles themselves are served
// through /api/weather/tile so viewers never talk to third parties directly.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 5 * 60_000
let cached: { expiresAt: number; body: unknown } | null = null

export async function GET() {
  const now = Date.now()
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.body, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    })
  }

  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      return NextResponse.json({ error: `Radar upstream HTTP ${res.status}` }, { status: 502 })
    }
    const data = await res.json()

    // Only past frames: their tile URLs are plain unix timestamps we can
    // validate strictly in the tile proxy (nowcast paths carry opaque tokens).
    const past: Array<{ time: number }> = Array.isArray(data?.radar?.past) ? data.radar.past : []
    const frames = past
      .map((f) => Number(f?.time))
      .filter((t) => Number.isInteger(t) && t > 0)
      .slice(-6)

    const body = { frames, generatedAtMs: now }
    cached = { expiresAt: now + CACHE_TTL_MS, body }
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'public, max-age=120' },
    })
  } catch {
    if (cached) return NextResponse.json(cached.body)
    return NextResponse.json({ error: 'Radar service unavailable' }, { status: 502 })
  }
}
