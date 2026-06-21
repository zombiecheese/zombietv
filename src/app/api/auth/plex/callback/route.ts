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
import { sessionOptions, SessionData, defaultSession } from '@/lib/session'
import { checkPlexPin, getPlexUser, getPlexServerUrl } from '@/lib/plex-auth'
import { prisma }   from '@/lib/db'
import { toJson }   from '@/lib/json'

export async function GET(req: NextRequest) {
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
    return NextResponse.redirect(new URL('/?auth=error&reason=missing_pin', req.url))
  }

  try {
    // Check if the user has completed auth on plex.tv
    console.log('[Auth/Callback] Checking Plex pin:', pinId)
    const authToken = await checkPlexPin(pinId)
    if (!authToken) {
      // User hasn't authenticated yet (e.g. navigated back too quickly)
      console.log('[Auth/Callback] Pin not yet authenticated')
      return NextResponse.redirect(new URL('/?auth=error&reason=pin_not_authed', req.url))
    }
    console.log('[Auth/Callback] Got auth token from Plex')

    // Fetch user profile and server URL in parallel
    console.log('[Auth/Callback] Fetching user profile and server URL')
    let plexUser: any
    let plexServerUrl: string | null = null
    
    try {
      [plexUser, plexServerUrl] = await Promise.all([
        getPlexUser(authToken),
        getPlexServerUrl(authToken),
      ])
      console.log('[Auth/Callback] Got Plex user:', plexUser.email, 'and server:', plexServerUrl)
    } catch (err: any) {
      // Try to get user alone if server discovery fails
      console.log('[Auth/Callback] Server discovery failed:', err.message, '— attempting user-only auth')
      plexUser = await getPlexUser(authToken)
      console.log('[Auth/Callback] Got Plex user (server optional):', plexUser.email)
      plexServerUrl = null // Allow login without a server
    }

    // Upsert the user in the DB
    console.log('[Auth/Callback] Upserting user in database')
    const user = await prisma.user.upsert({
      where:  { plexId: plexUser.id },
      update: {
      email:    plexUser.email,
      username: plexUser.username,
      // Store Plex credentials in preferences so the scheduler can use them
      preferences: toJson({
        plexToken:     authToken,
        plexServerUrl: plexServerUrl ?? '',
      }),
      },
      create: {
      plexId:   plexUser.id,
      email:    plexUser.email,
      username: plexUser.username,
      isAdmin:  false,
      preferences: toJson({
        plexToken:     authToken,
        plexServerUrl: plexServerUrl ?? '',
      }),
      },
    })
    console.log('[Auth/Callback] User upserted:', user.id)

    // Create a generic Response that iron-session can modify
    // Don't use NextResponse — use the base Response class for full control
    const response = new Response()
    
    // Create the iron-session
    console.log('[Auth/Callback] Creating iron-session')
    const session = await getIronSession<SessionData>(req, response as any, sessionOptions)
    session.isLoggedIn = true
    session.userId = user.id
    session.plexToken = authToken
    session.plexServerUrl = plexServerUrl ?? ''
    session.plexId = plexUser.id
    session.username = plexUser.username
    session.email = plexUser.email
    session.isAdmin = user.isAdmin
    console.log('[Auth/Callback] Session object set, calling save()')
    await session.save()
    console.log('[Auth/Callback] Session.save() completed')

    // Get the session cookie from response headers
    const setCookie = response.headers.get('set-cookie')
    console.log('[Auth/Callback] Set-Cookie header:', setCookie ? 'FOUND' : 'MISSING')

    // Create the redirect response with all necessary headers
    const redirectHeaders = new Headers({
      'Location': new URL('/', req.url).toString(),
    })
    
    // Add the session cookie if present
    if (setCookie) {
      redirectHeaders.set('set-cookie', setCookie)
    }

    // Create final response with status 307 (Temporary Redirect)
    const finalResponse = new Response(null, {
      status: 307,
      headers: redirectHeaders,
    })
    
    // Clear the pin cookie using the Set-Cookie header
    // Format: Set-Cookie: name=; Max-Age=0; Path=/
    const existingSetCookie = finalResponse.headers.get('set-cookie') || ''
    const pinClearCookie = 'plex_pin_id=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    
    // Append the pin clear cookie
    if (existingSetCookie) {
      // If there's already a Set-Cookie, we need to add both
      // This is a bit tricky — we need to handle multiple Set-Cookie headers
      finalResponse.headers.append('set-cookie', pinClearCookie)
    } else {
      finalResponse.headers.set('set-cookie', pinClearCookie)
    }
    
    console.log('[Auth/Callback] Returning redirect response with session cookie')
    return finalResponse
  } catch (err: any) {
    console.error('[Auth] Plex callback error:', err)
    return NextResponse.redirect(new URL(`/?auth=error&reason=${encodeURIComponent(err.message)}`, req.url))
  }
}
