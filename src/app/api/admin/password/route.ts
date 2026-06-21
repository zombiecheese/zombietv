import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/db'
import { fromJsonObject, toJson } from '@/lib/json'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const currentPassword = String(body?.currentPassword ?? '')
  const newPassword = String(body?.newPassword ?? '')

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Current and new password are required.' }, { status: 400 })
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: guard.session.userId },
    select: { id: true, isAdmin: true, preferences: true },
  })

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
  await prisma.user.update({
    where: { id: user.id },
    data: {
      preferences: toJson({
        ...prefs,
        passwordHash: nextHash,
      }),
    },
  })

  return NextResponse.json({ ok: true })
}