import { NextRequest, NextResponse } from 'next/server'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function getHostFromUrl(value: string | null): string | null {
  if (!value) return null
  try {
    return new URL(value).host.toLowerCase()
  } catch {
    return null
  }
}

function getRequestHost(req: NextRequest): string {
  return (req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host || '').toLowerCase()
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (!pathname.startsWith('/api/admin/')) return NextResponse.next()
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return NextResponse.next()

  const requestHost = getRequestHost(req)
  const originHost = getHostFromUrl(req.headers.get('origin'))
  const refererHost = getHostFromUrl(req.headers.get('referer'))

  const isSameOrigin = Boolean(
    (originHost && originHost === requestHost) ||
    (refererHost && refererHost === requestHost),
  )

  if (!isSameOrigin) {
    return NextResponse.json({ error: 'Forbidden (origin mismatch)' }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/admin/:path*'],
}
