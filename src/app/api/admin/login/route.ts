// POST /api/admin/login
// Email + bcrypt password login for admin users.
// Creates an iron-session on success.
// This is separate from Plex OAuth — admins log in with their DB credentials.

import { NextRequest, NextResponse } from 'next/server'
import { getIronSession }            from 'iron-session'
import bcrypt                        from 'bcryptjs'
import { prisma }                    from '@/lib/db'
import { sessionOptions, SessionData, defaultSession } from '@/lib/session'
import { decryptSecret }             from '@/lib/secret-box'

export const dynamic = 'force-dynamic'

const LOGIN_WINDOW_MS = 10 * 60_000
const LOGIN_MAX_ATTEMPTS = 8
const LOGIN_BLOCK_MS = 15 * 60_000
const LOGIN_TRACKER_MAX = 2_000

type LoginThrottleState = {
  count: number
  windowStartMs: number
  blockedUntilMs: number
}

const loginThrottle = new Map<string, LoginThrottleState>()

function buildThrottleKey(req: NextRequest, email: string): string {
  const forwarded = req.headers.get('x-forwarded-for') ?? ''
  const ip = forwarded.split(',')[0]?.trim() || 'unknown'
  return `${ip}:${email.trim().toLowerCase()}`
}

function pruneThrottleMap(now: number) {
  for (const [key, entry] of loginThrottle.entries()) {
    const expiredWindow = now - entry.windowStartMs > LOGIN_WINDOW_MS
    const noBlock = entry.blockedUntilMs <= now
    if (expiredWindow && noBlock) loginThrottle.delete(key)
  }

  while (loginThrottle.size > LOGIN_TRACKER_MAX) {
    const oldest = loginThrottle.keys().next().value
    if (!oldest) break
    loginThrottle.delete(oldest)
  }
}

function registerLoginFailure(key: string, now: number): LoginThrottleState {
  const current = loginThrottle.get(key)
  if (!current || now - current.windowStartMs > LOGIN_WINDOW_MS) {
    const next = { count: 1, windowStartMs: now, blockedUntilMs: 0 }
    loginThrottle.set(key, next)
    return next
  }

  const count = current.count + 1
  const blockedUntilMs = count >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_BLOCK_MS : current.blockedUntilMs
  const next = { ...current, count, blockedUntilMs }
  loginThrottle.set(key, next)
  return next
}

function clearLoginFailures(key: string) {
  loginThrottle.delete(key)
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({ email: '', password: '' }))
  const now = Date.now()
  const throttleKey = buildThrottleKey(req, email)
  pruneThrottleMap(now)

  const throttleState = loginThrottle.get(throttleKey)
  if (throttleState && throttleState.blockedUntilMs > now) {
    const retryAfterSec = Math.ceil((throttleState.blockedUntilMs - now) / 1000)
    return NextResponse.json(
      { error: 'Too many login attempts. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSec) },
      },
    )
  }

  if (!email || !password) {
    registerLoginFailure(throttleKey, now)
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { email } })

  if (!user || !user.isAdmin) {
    registerLoginFailure(throttleKey, now)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  // The admin's bcrypt hash is stored in preferences.passwordHash
  const prefs = (() => { try { return JSON.parse(user.preferences) } catch { return {} } })()
  const hash: string = prefs.passwordHash ?? ''

  const valid = hash ? await bcrypt.compare(password, hash) : false
  if (!valid) {
    registerLoginFailure(throttleKey, now)
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  clearLoginFailures(throttleKey)

  const response = NextResponse.json({ ok: true, username: user.username ?? user.email })
  const session  = await getIronSession<SessionData>(req, response, sessionOptions)

  Object.assign(session, {
    ...defaultSession,
    isLoggedIn:    true,
    userId:        user.id,
    plexToken:     decryptSecret(prefs.plexToken ?? ''),
    plexServerUrl: prefs.plexServerUrl ?? '',
    plexId:        user.plexId         ?? '',
    username:      user.username       ?? user.email,
    email:         user.email,
    isAdmin:       true,
  } satisfies SessionData)
  await session.save()

  return response
}
