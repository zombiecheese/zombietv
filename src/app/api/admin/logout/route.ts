import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, SessionData } from '@/lib/session'

export const dynamic = 'force-dynamic'

// POST /api/admin/logout
// Drops admin access but preserves the underlying session so Plex login state remains intact.
export async function POST(req: NextRequest) {
  const response = NextResponse.json({ ok: true })
  const session = await getIronSession<SessionData>(req, response, sessionOptions)

  if (session.isLoggedIn && session.isAdmin) {
    session.isAdmin = false
    await session.save()
  }

  return response
}