// GET /api/auth/session
// Returns the current session data so client components know who is logged in.
// Returns 401 if not authenticated.
// Must be dynamic — reads cookies and SESSION_SECRET at request time.
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'
import { sessionOptions, SessionData, defaultSession } from '@/lib/session'

export async function GET(req: NextRequest) {
  const response = new NextResponse()
  const session  = await getIronSession<SessionData>(req, response, sessionOptions)

  if (!session.isLoggedIn) {
    return NextResponse.json({ isLoggedIn: false }, { status: 401 })
  }

  return NextResponse.json({
    isLoggedIn: true,
    userId:     session.userId,
    username:   session.username,
    email:      session.email,
    isAdmin:    session.isAdmin,
    plexToken:  session.plexToken || null,
    plexServerUrl: session.plexServerUrl || null,
  })
}
