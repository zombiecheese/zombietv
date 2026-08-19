// GET /api/auth/plex/callback?pinID=xxx
//
// Step 2 of Plex OAuth:
//   1. Reads the pin ID from the cookie (or query param as fallback)
//   2. Checks the pin against plex.tv — if authenticated, we get an authToken
//   3. Fetches the user profile and server URL
//   4. Creates or updates the User record in the DB
//   5. Creates an iron-session and redirects to the app

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'

export const dynamic = 'force-dynamic'
import { sessionOptions, SessionData, shouldUseSecureCookies } from '@/lib/session'
import { checkPlexPin, getPlexUser, getPlexServerUrlWithOptions } from '@/lib/plex-auth'
import { getPlexAuthRedirectBaseUrl } from '@/lib/plex-auth-redirect'
import { prisma }   from '@/lib/db'
import { toJson }   from '@/lib/json'
import { encryptSecret } from '@/lib/secret-box'

function getRequestOrigin(req: NextRequest): string {
  const xfHost = req.headers.get('x-forwarded-host')?.trim()
  const xfProto = req.headers.get('x-forwarded-proto')?.trim()
  if (xfHost) {
    const proto = xfProto || 'https'
    return `${proto}://${xfHost}`
  }
  return req.nextUrl.origin
}

export async function GET(req: NextRequest) {
  const requestOrigin = getRequestOrigin(req)
  const redirectBaseUrl = requestOrigin || (await getPlexAuthRedirectBaseUrl()) || req.nextUrl.origin
  const url = new URL(req.url)

  // Pin ID comes from cookie (preferred) or query string (Plex appends ?pinID=)
  const cookiePinId = req.cookies.get('plex_pin_id')?.value
  const queryPinId  =
    url.searchParams.get('pinID') ??
    url.searchParams.get('pinId') ??
    url.searchParams.get('pin_id')
  const pinId       = Number(cookiePinId ?? queryPinId)

  console.log('[Auth/Callback] Starting Plex callback', { cookiePinId, queryPinId, pinId })

  if (!pinId || isNaN(pinId)) {
    console.log('[Auth/Callback] Missing or invalid pin ID')
    return NextResponse.redirect(new URL('/?auth=error&reason=missing_pin', redirectBaseUrl))
  }

  try {
    // Check if the user has completed auth on plex.tv
    console.log('[Auth/Callback] Checking Plex pin:', pinId)
    const authToken = await checkPlexPin(pinId)
    if (!authToken) {
      // User hasn't authenticated yet (e.g. navigated back too quickly)
      console.log('[Auth/Callback] Pin not yet authenticated')
      return NextResponse.redirect(new URL('/?auth=error&reason=pin_not_authed', redirectBaseUrl))
    }
    console.log('[Auth/Callback] Got auth token from Plex')

    // Fetch user profile first, then require a remote Plex playback endpoint.
    console.log('[Auth/Callback] Fetching user profile and remote server URL')
    const plexUser = await getPlexUser(authToken)
    let plexServerUrl: string
    try {
      plexServerUrl = await getPlexServerUrlWithOptions(authToken, { allowLanFallback: false })
      console.log('[Auth/Callback] Got Plex user:', plexUser.email, 'and remote server:', plexServerUrl)
    } catch (err: any) {
      console.log('[Auth/Callback] Remote server discovery failed:', err?.message)
      return NextResponse.redirect(new URL('/?auth=error&reason=no_remote_server', redirectBaseUrl))
    }

    // Upsert the user in the DB
    console.log('[Auth/Callback] Upserting user in database')
    const user = await prisma.user.upsert({
      where:  { plexId: plexUser.id },
      update: {
      email:    plexUser.email,
      username: plexUser.username,
      // Store Plex credentials in preferences so the scheduler can use them
      // (token encrypted at rest — see secret-box.ts).
      preferences: toJson({
        plexToken:     encryptSecret(authToken),
        plexServerUrl: plexServerUrl,
      }),
      },
      create: {
      plexId:   plexUser.id,
      email:    plexUser.email,
      username: plexUser.username,
      isAdmin:  false,
      preferences: toJson({
        plexToken:     encryptSecret(authToken),
        plexServerUrl: plexServerUrl,
      }),
      },
    })
    console.log('[Auth/Callback] User upserted:', user.id)

    // Create redirect response first so iron-session writes cookies directly on
    // the final response object returned to the browser/proxy chain.
    const successUrl = new URL('/auth/plex/finish', redirectBaseUrl)
    successUrl.searchParams.set('pinID', String(pinId))
    const finalResponse = NextResponse.redirect(successUrl)

    // Create the iron-session
    console.log('[Auth/Callback] Creating iron-session')
    const session = await getIronSession<SessionData>(req, finalResponse, sessionOptions)
    session.isLoggedIn = true
    session.userId = user.id
    session.plexToken = authToken
    session.plexServerUrl = plexServerUrl
    session.plexId = plexUser.id
    session.username = plexUser.username
    session.email = plexUser.email
    session.isAdmin = user.isAdmin
    console.log('[Auth/Callback] Session object set, calling save()')
    await session.save()
    console.log('[Auth/Callback] Session.save() completed')

    console.log('[Auth/Callback] Session cookie written to redirect response')
    finalResponse.cookies.set('plex_pin_id', '', {
      httpOnly: true,
      secure: shouldUseSecureCookies(),
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })
    
    console.log('[Auth/Callback] Returning redirect response with session cookie')
    return finalResponse
  } catch (err: any) {
    console.error('[Auth] Plex callback error:', err)
    return NextResponse.redirect(new URL(`/?auth=error&reason=${encodeURIComponent(err.message)}`, redirectBaseUrl))
  }
}
