import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { ensureDatabaseReady, prisma } from '@/lib/db'
import { fromJsonObject } from '@/lib/json'
import { getCatalogStatus, isCatalogSyncRunning, triggerCatalogSync, saveCatalogPlaybackServerUrl } from '@/lib/plex-catalog'
import { PlexClient } from '@/lib/plex-client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await ensureDatabaseReady()
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const status = await getCatalogStatus()
  return NextResponse.json({
    running: isCatalogSyncRunning() || status.syncProgress.isRunning,
    status,
  })
}

export async function POST(req: NextRequest) {
  await ensureDatabaseReady()
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const admin = await prisma.user.findUnique({
    where: { id: guard.session.userId },
    select: { preferences: true },
  })

  const prefs = fromJsonObject<Record<string, unknown>>(admin?.preferences)
  const plexToken = String(prefs.plexToken ?? '')
  const plexServerUrl = String(prefs.plexServerUrl ?? '')

  if (!plexToken || !plexServerUrl) {
    return NextResponse.json(
      { error: 'Admin Plex credentials are required before catalog sync.' },
      { status: 400 },
    )
  }

  await saveCatalogPlaybackServerUrl(plexServerUrl)

  const plex = new PlexClient(plexServerUrl, plexToken)
  const result = await triggerCatalogSync(plex)
  const status = await getCatalogStatus()

  return NextResponse.json({
    ok: true,
    started: result.started,
    running: isCatalogSyncRunning() || status.syncProgress.isRunning,
    status,
  })
}