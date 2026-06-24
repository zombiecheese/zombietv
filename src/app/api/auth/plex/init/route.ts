// POST /api/auth/plex/init
//
// Step 1 of Plex OAuth:
//   1. Creates a Plex pin
//   2. Stores the pin ID in a short-lived cookie so the callback can read it
//   3. Returns the plex.tv auth URL for the client to redirect to

import { NextRequest, NextResponse } from 'next/server'
import { createPlexPin, buildPlexAuthUrl } from '@/lib/plex-auth'
import { getPlexAuthRedirectBaseUrl } from '@/lib/plex-auth-redirect'
import { shouldUseSecureCookies } from '@/lib/session'

export const dynamic = 'force-dynamic'

function getRequestOrigin(req: NextRequest): string {
  const xfHost = req.headers.get('x-forwarded-host')?.trim()
  const xfProto = req.headers.get('x-forwarded-proto')?.trim()
  if (xfHost) {
    const proto = xfProto || 'https'
    return `${proto}://${xfHost}`
  }
  return req.headers.get('origin') ?? req.nextUrl.origin
}

export async function POST(req: NextRequest) {
  try {
    const pin = await createPlexPin()

    // The forwardUrl is where Plex redirects after the user authenticates.
    // It must be an absolute URL so Plex can redirect to it.
    const overrideBaseUrl = await getPlexAuthRedirectBaseUrl()
    const origin = overrideBaseUrl ?? process.env.NEXTAUTH_URL ?? getRequestOrigin(req) ?? 'http://localhost:3000'
    // Include pinID in the callback URL so callback can still complete
    // even if the short-lived cookie is blocked or dropped.
    const callback = new URL('/api/auth/plex/callback', origin)
    callback.searchParams.set('pinID', String(pin.id))
    const callbackUrl = callback.toString()
    const authUrl     = buildPlexAuthUrl(pin, callbackUrl)

    const response = NextResponse.json({ authUrl, pinId: pin.id })

    // Store the pin ID in a short-lived httpOnly cookie (15 min)
    response.cookies.set('plex_pin_id', String(pin.id), {
      httpOnly: true,
      secure:   shouldUseSecureCookies(),
      sameSite: 'lax',
      maxAge:   900, // 15 minutes
      path:     '/',
    })

    return response
  } catch (err: any) {
    console.error('[Auth] Plex init error:', err)
    return NextResponse.json({ error: 'Failed to initiate Plex auth' }, { status: 500 })
  }
}
