// GET  /api/vhs-settings  — returns current global VHS effect settings
// POST /api/vhs-settings  — admin-only, updates one or more settings

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'

export const dynamic = 'force-dynamic'
import { sessionOptions, SessionData } from '@/lib/session'
import { getGlobalVHSSettings, saveGlobalVHSSettings } from '@/lib/vhs-settings'

export async function GET() {
  const settings = await getGlobalVHSSettings()

  return NextResponse.json(settings, {
    headers: { 'Cache-Control': 'public, max-age=30' },
  })
}

export async function POST(req: NextRequest) {
  const res     = new NextResponse()
  const session = await getIronSession<SessionData>(req, res, sessionOptions)

  if (!session.isLoggedIn || !session.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  await saveGlobalVHSSettings(body)

  return NextResponse.json({ ok: true })
}
