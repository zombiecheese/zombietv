// GET /api/admin/plex/callback?pinID=xxx
// Completes admin Plex OAuth and stores plexToken + plexServerUrl on the admin user.

import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { getIronSession } from 'iron-session'
import { prisma } from '@/lib/db'
import { fromJsonObject, toJson } from '@/lib/json'
import { encryptSecret } from '@/lib/secret-box'
import { checkPlexPin, getPlexServerUrl } from '@/lib/plex-auth'
import { getPlexAuthRedirectBaseUrl } from '@/lib/plex-auth-redirect'
import { sessionOptions, SessionData, resolveSessionPassword } from '@/lib/session'
import { saveCatalogPlaybackServerUrl } from '@/lib/plex-catalog'

export const dynamic = 'force-dynamic'

function signAdminState(userId: string) {
  return createHmac('sha256', resolveSessionPassword()).update(userId).digest('hex')
}

function isValidAdminState(userId: string, state: string) {
  const expected = Buffer.from(signAdminState(userId), 'utf8')
  const actual = Buffer.from(state, 'utf8')

  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export async function GET(req: NextRequest) {
  const redirectBaseUrl = (await getPlexAuthRedirectBaseUrl()) ?? req.url
  const redirect = (reason: string) => NextResponse.redirect(new URL(`/admin/dashboard?plex=${encodeURIComponent(reason)}`, redirectBaseUrl))
  const url = new URL(req.url)
  const baseResponse = new Response()
  const session = await getIronSession<SessionData>(req, baseResponse, sessionOptions)

  const sessionAdminId = session.isLoggedIn && session.isAdmin && session.userId ? session.userId : ''
  const sessionAdminEmail = session.isLoggedIn && session.isAdmin && session.email ? session.email : ''
  const callbackAdminId = url.searchParams.get('adminUserId') ?? ''
  const callbackState = url.searchParams.get('state') ?? ''
  const callbackStateValid = callbackAdminId && callbackState ? isValidAdminState(callbackAdminId, callbackState) : false

  const adminUserId = sessionAdminId || (callbackStateValid ? callbackAdminId : '')
  if (!adminUserId) {
    return redirect('forbidden')
  }

  const cookiePinId = req.cookies.get('plex_admin_pin_id')?.value
  const queryPinId = url.searchParams.get('pinID')
  const pinId = Number(cookiePinId ?? queryPinId)
  if (!pinId || Number.isNaN(pinId)) {
    return redirect('missing_pin')
  }

  try {
    const authToken = await checkPlexPin(pinId)
    if (!authToken) {
      return redirect('pin_not_authed')
    }

    const plexServerUrl = await getPlexServerUrl(authToken)
    await saveCatalogPlaybackServerUrl(plexServerUrl)

    const admin = await prisma.user.findUnique({ where: { id: adminUserId } })
      ?? (sessionAdminEmail
        ? await prisma.user.findUnique({ where: { email: sessionAdminEmail } })
        : null)
    if (!admin || !admin.isAdmin) {
      return redirect('forbidden')
    }

    const prefs = fromJsonObject<Record<string, unknown>>(admin.preferences)
    await prisma.user.update({
      where: { id: admin.id },
      data: {
        preferences: toJson({
          ...prefs,
          // Encrypted at rest — decrypted via decryptSecret at read sites.
          plexToken: encryptSecret(authToken),
          plexServerUrl,
        }),
      },
    })

    if (session.isLoggedIn && session.isAdmin) {
      session.userId = admin.id
      session.email = admin.email
      session.username = admin.username ?? admin.email
      session.plexToken = authToken
      session.plexServerUrl = plexServerUrl
      await session.save()
    }

    // Create the redirect response with all necessary headers
    const redirectHeaders = new Headers({
      'Location': new URL('/admin/dashboard?plex=connected', redirectBaseUrl).toString(),
    })
    
    // Get the session cookie from response headers and propagate it
    const setCookie = baseResponse.headers.get('set-cookie')
    if (setCookie) {
      redirectHeaders.set('set-cookie', setCookie)
    }

    // Clear the pin cookie
    const pinClearCookie = 'plex_admin_pin_id=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    if (setCookie) {
      redirectHeaders.append('set-cookie', pinClearCookie)
    } else {
      redirectHeaders.set('set-cookie', pinClearCookie)
    }

    return new Response(null, {
      status: 307,
      headers: redirectHeaders,
    })
  } catch (err: any) {
    console.error('[Admin/Plex] Callback error:', err)
    return redirect('connect_failed')
  }
}
