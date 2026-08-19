// GET /api/plex-art?path=/library/metadata/123/thumb/456
// Authenticated Plex artwork proxy: serves poster/background art through the
// server (admin credentials) so viewer clients never see the Plex token.
// Only /library/metadata/{id}/thumb|art paths are allowed.
//
// Public endpoint — artwork is presentation data for the viewer UI.

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { fromJsonObject } from '@/lib/json'
import { decryptSecret } from '@/lib/secret-box'
import { getCatalogPlaybackServerUrl } from '@/lib/plex-catalog'

export const dynamic = 'force-dynamic'

const ART_PATH_RE = /^\/library\/metadata\/\d+\/(thumb|art)(\/\d+)?$/

let cachedCreds: { expiresAt: number; serverUrl: string; token: string } | null = null

async function getAdminPlexCreds(): Promise<{ serverUrl: string; token: string } | null> {
  const now = Date.now()
  if (cachedCreds && cachedCreds.expiresAt > now) {
    return { serverUrl: cachedCreds.serverUrl, token: cachedCreds.token }
  }

  const adminUsers = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { preferences: true },
  })

  for (const adminUser of adminUsers) {
    const prefs = fromJsonObject<Record<string, string>>(adminUser.preferences)
    const token = decryptSecret(prefs?.plexToken ?? '')
    const fallbackUrl = prefs?.plexServerUrl ?? ''
    if (!token) continue
    const serverUrl = await getCatalogPlaybackServerUrl(fallbackUrl)
    if (!serverUrl) continue
    cachedCreds = { serverUrl, token, expiresAt: now + 5 * 60_000 }
    return { serverUrl, token }
  }
  return null
}

export async function GET(req: NextRequest) {
  const path = new URL(req.url).searchParams.get('path') ?? ''
  if (!ART_PATH_RE.test(path)) {
    return NextResponse.json({ error: 'Invalid art path' }, { status: 400 })
  }

  const creds = await getAdminPlexCreds()
  if (!creds) {
    return NextResponse.json({ error: 'Plex is not connected' }, { status: 503 })
  }

  try {
    const upstream = await fetch(`${creds.serverUrl}${path}?X-Plex-Token=${encodeURIComponent(creds.token)}`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Art upstream HTTP ${upstream.status}` }, { status: 502 })
    }

    return new NextResponse(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        // Art paths are versioned by Plex (…/thumb/<rev>), so long caching is safe.
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Art fetch failed' }, { status: 502 })
  }
}
