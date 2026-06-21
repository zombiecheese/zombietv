import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireAdmin } from '@/lib/admin-guard'
import { ensureSqlitePragmas, prisma } from '@/lib/db'
import { fromJsonObject, toJson } from '@/lib/json'

export const dynamic = 'force-dynamic'

function isSqliteBusyTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybeCode = String((err as any).code ?? '')
  const maybeContext = String((err as any).meta?.context ?? '').toLowerCase()
  return maybeCode === 'P1008' && maybeContext.includes('database failed to respond')
}

async function withSqliteRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isSqliteBusyTimeoutError(err) || i === attempts - 1) {
        throw err
      }
      await new Promise((resolve) => setTimeout(resolve, 150 * (i + 1)))
    }
  }
  throw lastErr
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response
  await ensureSqlitePragmas()

  const body = await req.json().catch(() => ({}))
  const currentPassword = String(body?.currentPassword ?? '')
  const newPassword = String(body?.newPassword ?? '')

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Current and new password are required.' }, { status: 400 })
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  }

  const user = await withSqliteRetry(() => prisma.user.findUnique({
    where: { id: guard.session.userId },
    select: { id: true, isAdmin: true, preferences: true },
  }))

  if (!user || !user.isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const prefs = fromJsonObject<Record<string, unknown>>(user.preferences)
  const hash = String(prefs.passwordHash ?? '')
  const valid = hash ? await bcrypt.compare(currentPassword, hash) : false

  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
  }

  const nextHash = await bcrypt.hash(newPassword, 10)
  await withSqliteRetry(() => prisma.user.update({
    where: { id: user.id },
    data: {
      preferences: toJson({
        ...prefs,
        passwordHash: nextHash,
      }),
    },
  }))

  return NextResponse.json({ ok: true })
}