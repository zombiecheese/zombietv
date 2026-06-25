import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { prisma } from '@/lib/db'
import { fromJsonObject } from '@/lib/json'
import { getCatalogFilterOptions, listCatalogLibraries } from '@/lib/plex-catalog'
import { PlexClient } from '@/lib/plex-client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const [options, libraries] = await Promise.all([
    getCatalogFilterOptions(),
    listCatalogLibraries(),
  ])

  if (options.languages.length === 0) {
    const admin = await prisma.user.findUnique({
      where: { id: guard.session.userId },
      select: { preferences: true },
    })
    const prefs = fromJsonObject<Record<string, unknown>>(admin?.preferences)
    const plexToken = String(prefs.plexToken ?? '')
    const plexServerUrl = String(prefs.plexServerUrl ?? '')

    if (plexToken && plexServerUrl) {
      const plex = new PlexClient(plexServerUrl, plexToken)
      const languageCounts = new Map<string, number>()
      const items = [
        ...(await plex.searchMovies({}).catch(() => [])),
        ...(await plex.searchShows({}).catch(() => [])),
      ]

      for (const item of items) {
        for (const language of item.languages ?? []) {
          const normalized = String(language).trim().toLowerCase()
          if (!normalized) continue
          languageCounts.set(normalized, (languageCounts.get(normalized) ?? 0) + 1)
        }
      }

      options.languages = Array.from(languageCounts.entries())
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    }
  }

  return NextResponse.json({
    ...options,
    libraries: libraries.map((library) => ({
      value: library.key,
      label: library.title,
      count: 0,
    })),
  })
}
