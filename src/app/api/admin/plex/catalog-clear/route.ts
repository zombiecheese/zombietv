import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CATALOG_STATE_STATION_ID = '__global__'
const CATALOG_STATE_KEYS_TO_CLEAR = [
  'plex_catalog_last_sync_at',
  'plex_catalog_last_sync_summary',
  'plex_catalog_sync_progress',
  'plex_catalog_active_plex_keys',
  'plex_catalog_active_class_by_plex_key',
]

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const result = await prisma.$transaction(async (tx) => {
    // Detach schedule links first so catalog rows can be deleted safely.
    const removedSlotLinks = await tx.slotMediaItem.deleteMany({})
    const removedCatalog = await tx.mediaItem.deleteMany({})
    const removedShowProgress = await tx.showProgress.deleteMany({})
    const removedCatalogState = await tx.adminPreference.deleteMany({
      where: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: { in: CATALOG_STATE_KEYS_TO_CLEAR },
      },
    })

    return {
      removedSlotLinks: removedSlotLinks.count,
      removedCatalog: removedCatalog.count,
      removedShowProgress: removedShowProgress.count,
      removedCatalogState: removedCatalogState.count,
    }
  })

  return NextResponse.json({ ok: true, ...result })
}