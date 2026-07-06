import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { prisma } from '@/lib/db'
import { toJson } from '@/lib/json'
import { encryptSecret } from '@/lib/secret-box'
import { sessionOptions, SessionData } from '@/lib/session'
import { checkPlexPin, getPlexUser, getPlexServerUrlWithOptions } from '@/lib/plex-auth'

export const dynamic = 'force-dynamic'

function parsePinId(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return NaN
  return Math.floor(parsed)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const pinId = parsePinId(body?.pinID ?? body?.pinId ?? body?.pin_id)

    if (!pinId || Number.isNaN(pinId)) {
      return NextResponse.json({ error: 'Missing or invalid pinID.' }, { status: 400 })
    }

    const authToken = await checkPlexPin(pinId)
    if (!authToken) {
      return NextResponse.json({ error: 'Plex PIN not authorized yet.' }, { status: 409 })
    }

    const plexUser = await getPlexUser(authToken)
    const plexServerUrl = await getPlexServerUrlWithOptions(authToken, { allowLanFallback: false })

    const user = await prisma.user.upsert({
      where: { plexId: plexUser.id },
      update: {
        email: plexUser.email,
        username: plexUser.username,
        preferences: toJson({
          plexToken: encryptSecret(authToken),
          plexServerUrl,
        }),
      },
      create: {
        plexId: plexUser.id,
        email: plexUser.email,
        username: plexUser.username,
        isAdmin: false,
        preferences: toJson({
          plexToken: encryptSecret(authToken),
          plexServerUrl,
        }),
      },
    })

    const response = NextResponse.json({ ok: true, isLoggedIn: true })
    const session = await getIronSession<SessionData>(req, response, sessionOptions)
    session.isLoggedIn = true
    session.userId = user.id
    session.plexToken = authToken
    session.plexServerUrl = plexServerUrl
    session.plexId = plexUser.id
    session.username = plexUser.username
    session.email = plexUser.email
    session.isAdmin = user.isAdmin
    await session.save()

    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    return response
  } catch (err: any) {
    console.error('[Auth/Complete] error:', err)
    return NextResponse.json({ error: 'Failed to complete Plex sign-in.' }, { status: 500 })
  }
}
