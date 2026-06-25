// Admin guard helper
// Call at the top of any admin API route to verify the session is an admin.
// Returns the session on success, or a 403 NextResponse on failure.

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'
import { sessionOptions, SessionData } from './session'

type GuardResult =
  | { ok: true;  session: SessionData; response: NextResponse }
  | { ok: false; response: NextResponse }

export async function requireAdmin(req: NextRequest): Promise<GuardResult> {
  const response = new NextResponse()
  const session  = await getIronSession<SessionData>(req, response, sessionOptions)

  if (!session.isLoggedIn || !session.isAdmin) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    }
  }
  return { ok: true, session, response }
}
