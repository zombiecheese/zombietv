// GET /api/auth/session
// Returns the current session data so client components know who is logged in.
// Returns a normal JSON payload even when not authenticated.
// Must be dynamic — reads cookies and SESSION_SECRET at request time.
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'
import { sessionOptions, SessionData, defaultSession } from '@/lib/session'

export async function GET(req: NextRequest) {
  const response = new NextResponse()
  const session  = await getIronSession<SessionData>(req, response, sessionOptions)
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  response.headers.set('Pragma', 'no-cache')

  if (!session.isLoggedIn) {
    return NextResponse.json(
      { isLoggedIn: false },
      { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' } },
    )
  }

  return NextResponse.json(
    {
      isLoggedIn: true,
      userId:     session.userId,
      username:   session.username,
      email:      session.email,
      isAdmin:    session.isAdmin,
      plexToken:  session.plexToken || null,
      plexServerUrl: session.plexServerUrl || null,
    },
    { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' } },
  )
}
