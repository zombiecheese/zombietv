// POST /api/admin/youtube/validate — checks every filler video against
// YouTube's oEmbed endpoint and reports entries that are deleted, private,
// or have embedding disabled (the usual cause of "black box" filler).

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CONCURRENCY = 8

interface FailedEntry {
  id: string
  videoId: string
  title: string
  status: number | 'error'
}

async function checkVideo(videoId: string): Promise<number | 'error'> {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) })
    return res.status
  } catch {
    return 'error'
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const items = await prisma.youtubeContent.findMany({
    where: { videoId: { not: null } },
    select: { id: true, videoId: true, title: true },
  })

  const failed: FailedEntry[] = []
  let checked = 0

  // Simple concurrency pool.
  const queue = [...items]
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const item = queue.shift()
      if (!item || !item.videoId) return
      const status = await checkVideo(item.videoId)
      checked += 1
      // 200 = embeddable; 401/403 = embedding disabled/private; 404 = gone.
      if (status !== 200) {
        failed.push({ id: item.id, videoId: item.videoId, title: item.title, status })
      }
    }
  })
  await Promise.all(workers)

  failed.sort((a, b) => a.title.localeCompare(b.title))

  return NextResponse.json({
    checked,
    ok: checked - failed.length,
    failed,
  })
}
