// POST /api/admin/login
// Email + bcrypt password login for admin users.
// Creates an iron-session on success.
// This is separate from Plex OAuth — admins log in with their DB credentials.

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'
import bcrypt                        from 'bcryptjs'
import { prisma }                    from '@/lib/db'
import { sessionOptions, SessionData, defaultSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({ email: '', password: '' }))

  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email } })

  if (!user || !user.isAdmin) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // The admin's bcrypt hash is stored in preferences.passwordHash
  const prefs = (() => { try { return JSON.parse(user.preferences) } catch { return {} } })()
  const hash: string = prefs.passwordHash ?? ''

  const valid = hash ? await bcrypt.compare(password, hash) : false
  if (!valid) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true, username: user.username ?? user.email })
  const session  = await getIronSession<SessionData>(req, response, sessionOptions)

  Object.assign(session, {
    ...defaultSession,
    isLoggedIn:    true,
    userId:        user.id,
    plexToken:     prefs.plexToken     ?? '',
    plexServerUrl: prefs.plexServerUrl ?? '',
    plexId:        user.plexId         ?? '',
    username:      user.username       ?? user.email,
    email:         user.email,
    isAdmin:       true,
  } satisfies SessionData)
  await session.save()

  return response
}
