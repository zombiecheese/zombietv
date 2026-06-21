// POST /api/auth/logout
// Destroys the iron-session cookie and redirects to home.

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'

export const dynamic = 'force-dynamic'
import { sessionOptions, SessionData } from '@/lib/session'

export async function POST(req: NextRequest) {
  const response = NextResponse.redirect(new URL('/', req.url))
  const session  = await getIronSession<SessionData>(req, response, sessionOptions)
  session.destroy()
  return response
}
