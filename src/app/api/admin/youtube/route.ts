// GET    /api/admin/youtube — list all YoutubeContent entries
// POST   /api/admin/youtube — add a new entry
// DELETE /api/admin/youtube — bulk remove entries by id

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma }       from '@/lib/db'
import { scrapeYouTubePlaylist, normalizePlaylistId, getYouTubeVideoDurationMins } from '@/lib/youtube-playlist'

export const dynamic = 'force-dynamic'

function normalizeYouTubeVideoId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw

  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()

    if (host === 'youtu.be') {
      const fromPath = url.pathname.split('/').filter(Boolean)[0] ?? ''
      return /^[A-Za-z0-9_-]{11}$/.test(fromPath) ? fromPath : ''
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const fromQuery = url.searchParams.get('v')?.trim() ?? ''
      if (/^[A-Za-z0-9_-]{11}$/.test(fromQuery)) return fromQuery

      const segments = url.pathname.split('/').filter(Boolean)
      const embedId = segments[0] === 'embed' ? segments[1] : ''
      if (/^[A-Za-z0-9_-]{11}$/.test(embedId ?? '')) return embedId
    }
  } catch {
    return ''
  }

  return ''
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const url      = new URL(req.url)
  const station  = url.searchParams.get('station')   // optional filter
  const category = url.searchParams.get('category')  // optional filter

  const items = await prisma.youtubeContent.findMany({
    where: {
      ...(station  ? { station }  : {}),
      ...(category ? { category } : {}),
    },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json(items)
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const { title, videoId, playlistId, isPlaylist, category, station, durationMins, dayParts, dateRange, exclusive } =
    await req.json().catch(() => ({}))

  const cleanDayParts = String(dayParts ?? '').trim() || null
  const cleanDateRange = String(dateRange ?? '').trim() || null
  const cleanExclusive = Boolean(exclusive)

  const cleanVideoId = normalizeYouTubeVideoId(videoId)
  const cleanPlaylistId = typeof playlistId === 'string' ? normalizePlaylistId(playlistId) : ''

  if (!title || !category) {
    return NextResponse.json({ error: 'title and category are required' }, { status: 400 })
  }
  if (!cleanVideoId && !cleanPlaylistId) {
    return NextResponse.json({ error: 'videoId or playlistId is required' }, { status: 400 })
  }

  if (cleanPlaylistId && !cleanVideoId) {
    try {
      const imported = await scrapeYouTubePlaylist(cleanPlaylistId)
      if (!imported.items.length) {
        return NextResponse.json({ error: 'Playlist did not contain any importable videos' }, { status: 400 })
      }

      let createdCount = 0
      let skippedCount = 0
      const fallbackDuration = typeof durationMins === 'number'
        ? durationMins
        : (typeof durationMins === 'string' && durationMins.trim() !== '' ? Number(durationMins) : null)

      for (const item of imported.items) {
        try {
          await prisma.youtubeContent.create({
            data: {
              title: item.title,
              videoId: item.videoId,
              playlistId: null,
              isPlaylist: false,
              category,
              station: station || null,
              durationMins: item.durationMins ?? fallbackDuration,
              dayParts: cleanDayParts,
              dateRange: cleanDateRange,
              exclusive: cleanExclusive,
            },
          })
          createdCount += 1
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            skippedCount += 1
            continue
          }
          throw err
        }
      }

      return NextResponse.json({
        ok: true,
        importedCount: createdCount,
        skippedCount,
        playlistTitle: imported.playlistTitle,
      }, { status: 201 })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import playlist'
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  let resolvedDurationMins: number | null = durationMins ? Number(durationMins) : null
  if ((!resolvedDurationMins || !Number.isFinite(resolvedDurationMins)) && cleanVideoId) {
    resolvedDurationMins = await getYouTubeVideoDurationMins(cleanVideoId).catch(() => null)
  }

  const entry = await prisma.youtubeContent.create({
    data: {
      title,
      videoId:     cleanVideoId || null,
      playlistId:  null,
      isPlaylist:  false,
      category,
      station:     station    || null,
      durationMins: resolvedDurationMins,
      dayParts:    cleanDayParts,
      dateRange:   cleanDateRange,
      exclusive:   cleanExclusive,
    },
  })

  return NextResponse.json(entry, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const ids = Array.isArray(body?.ids)
    ? body.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : []

  if (!ids.length) {
    return NextResponse.json({ error: 'ids array is required' }, { status: 400 })
  }

  const result = await prisma.youtubeContent.deleteMany({
    where: { id: { in: ids } },
  })

  return NextResponse.json({ ok: true, deletedCount: result.count })
}
