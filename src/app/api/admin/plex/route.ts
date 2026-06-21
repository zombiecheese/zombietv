// GET  /api/admin/plex — returns admin Plex connection status
// POST /api/admin/plex — starts Plex OAuth for the current admin user

import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/db'
import { fromJsonObject } from '@/lib/json'
import {
  getCatalogAutoSyncMaxAgeHours,
  getCatalogLibraryClassifications,
  getCatalogSelectedLibraryKeys,
  getCatalogStatus,
  isCatalogSyncRunning,
  LIBRARY_CLASS_OPTIONS,
} from '@/lib/plex-catalog'
import { PlexClient } from '@/lib/plex-client'
import { createPlexPin, buildPlexAuthUrl, getPlexServerDetails } from '@/lib/plex-auth'
import { getPlexAuthRedirectBaseUrl } from '@/lib/plex-auth-redirect'

export const dynamic = 'force-dynamic'

function signAdminState(userId: string) {
  return createHmac('sha256', sessionSecret()).update(userId).digest('hex')
}

function sessionSecret() {
  return process.env.SESSION_SECRET ?? 'zombietv-dev-secret-change-before-production-deploy'
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const admin = await prisma.user.findUnique({
    where: { id: guard.session.userId },
    select: { preferences: true },
  })

  const prefs = fromJsonObject<Record<string, unknown>>(admin?.preferences)
  const plexToken = String(prefs.plexToken ?? '')
  const plexServerUrl = String(prefs.plexServerUrl ?? '')
  const catalogStatus = await getCatalogStatus()
  const autoSyncMaxAgeHours = await getCatalogAutoSyncMaxAgeHours()
  const selectedLibraryKeys = await getCatalogSelectedLibraryKeys()
  const libraryClassifications = await getCatalogLibraryClassifications()
  const authRedirectBaseUrl = await getPlexAuthRedirectBaseUrl()
  const mediaCatalogCount = await prisma.mediaItem.count()
  const plexServerName = plexToken && plexServerUrl
    ? await getPlexServerDetails(plexToken).then((details) => details.name).catch(() => null)
    : null
  const libraries = plexToken && plexServerUrl
    ? await new PlexClient(plexServerUrl, plexToken).getSections().catch(() => [])
    : []

  return NextResponse.json({
    connected: !!plexToken && !!plexServerUrl,
    hasToken: !!plexToken,
    hasServer: !!plexServerUrl,
    plexServerName,
    plexServerUrl: plexServerUrl || null,
    authRedirectBaseUrl,
    catalogSyncRunning: isCatalogSyncRunning() || catalogStatus.syncProgress.isRunning,
    catalog: {
      itemCount: mediaCatalogCount,
      lastSyncAt: catalogStatus.lastSyncAt,
      autoSyncMaxAgeHours,
      selectedLibraryKeys,
      libraryClassifications,
      libraryClassOptions: LIBRARY_CLASS_OPTIONS,
      libraries,
      lastSummary: catalogStatus.lastSummary,
      syncProgress: catalogStatus.syncProgress,
    },
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  try {
    const pin = await createPlexPin()
    const overrideBaseUrl = await getPlexAuthRedirectBaseUrl()
    const origin = overrideBaseUrl ?? req.headers.get('origin') ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
    const callback = new URL('/api/admin/plex/callback', origin)
    callback.searchParams.set('adminUserId', guard.session.userId)
    callback.searchParams.set('state', signAdminState(guard.session.userId))
    const callbackUrl = callback.toString()
    const authUrl = buildPlexAuthUrl(pin, callbackUrl)

    const response = NextResponse.json({ authUrl, pinId: pin.id })
    response.cookies.set('plex_admin_pin_id', String(pin.id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 900,
      path: '/',
    })

    return response
  } catch (err: any) {
    console.error('[Admin/Plex] Init error:', err)
    return NextResponse.json({ error: 'Failed to initiate admin Plex auth' }, { status: 500 })
  }
}
