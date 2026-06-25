// POST /api/admin/youtube/backfill-durations
// Fetches and stores missing runtimes for YouTube video entries so filler can
// be fitted to gaps accurately. Playlists are skipped (their items are stored
// individually with their own durations on import).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/db'
import { getYouTubeVideoDurationMins } from '@/lib/youtube-playlist'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const pending = await prisma.youtubeContent.findMany({
    where: {
      durationMins: null,
      videoId: { not: null },
      isPlaylist: false,
    },
    select: { id: true, videoId: true },
    take: 200,
  })

  let updated = 0
  let failed = 0

  for (const item of pending) {
    if (!item.videoId) continue
    const mins = await getYouTubeVideoDurationMins(item.videoId).catch(() => null)
    if (mins && Number.isFinite(mins)) {
      await prisma.youtubeContent.update({
        where: { id: item.id },
        data: { durationMins: mins },
      }).catch(() => null)
      updated += 1
    } else {
      failed += 1
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: pending.length,
    updated,
    failed,
  })
}
