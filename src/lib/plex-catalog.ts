import { prisma } from './db'
import { fromJson, fromJsonObject, toJson } from './json'
import { PlexClient, PlexMediaItem } from './plex-client'

const PLEX_CATALOG_LAST_SYNC_KEY = 'plex_catalog_last_sync_at'
const PLEX_CATALOG_LAST_SUMMARY_KEY = 'plex_catalog_last_sync_summary'
const PLEX_CATALOG_SYNC_PROGRESS_KEY = 'plex_catalog_sync_progress'
const PLEX_CATALOG_AUTO_SYNC_MAX_AGE_HOURS_KEY = 'plex_catalog_auto_sync_max_age_hours'
const PLEX_CATALOG_BLOCKED_KEYS = 'plex_catalog_blocked_keys'
const PLEX_CATALOG_HOLIDAY_TAGS = 'plex_catalog_holiday_tags'
const PLEX_CATALOG_SELECTED_LIBRARY_KEYS = 'plex_catalog_selected_library_keys'
const PLEX_CATALOG_LIBRARY_CLASSIFICATIONS = 'plex_catalog_library_classifications'
const PLEX_CATALOG_ACTIVE_PLEX_KEYS = 'plex_catalog_active_plex_keys'
const PLEX_CATALOG_ACTIVE_CLASS_BY_PLEX_KEY = 'plex_catalog_active_class_by_plex_key'
const CATALOG_STATE_STATION_ID = '__global__'
export const DEFAULT_PLEX_CATALOG_AUTO_SYNC_MAX_AGE_HOURS = 72

export const LIBRARY_CLASS_OPTIONS = [
  'animation',
  'tv_shows',
  'movies',
  'fitness',
] as const

export type LibraryClass = (typeof LIBRARY_CLASS_OPTIONS)[number]

function normalizeLibraryClass(value: unknown): LibraryClass {
  const candidate = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '_')
  if (candidate === 'anime') return 'animation'
  if ((LIBRARY_CLASS_OPTIONS as readonly string[]).includes(candidate)) {
    return candidate as LibraryClass
  }
  return 'tv_shows'
}

function classGuidanceScore(classification: LibraryClass | undefined, type: 'movie' | 'show'): number {
  if (!classification) return 0
  switch (classification) {
    case 'animation':
      return type === 'show' ? 3 : 2
    case 'tv_shows':
      return type === 'show' ? 4 : 0
    case 'movies':
      return type === 'movie' ? 4 : 0
    case 'fitness':
      return type === 'show' ? 2 : 1
    default:
      return 0
  }
}

const SQLITE_MEDIAITEM_TABLE = '"MediaItem"'

const INDEX_STATEMENTS = [
  `CREATE INDEX IF NOT EXISTS idx_mediaitem_type ON ${SQLITE_MEDIAITEM_TABLE} (type)`,
  `CREATE INDEX IF NOT EXISTS idx_mediaitem_ratings ON ${SQLITE_MEDIAITEM_TABLE} (ratings)`,
  `CREATE INDEX IF NOT EXISTS idx_mediaitem_duration ON ${SQLITE_MEDIAITEM_TABLE} (durationMins)`,
  `CREATE INDEX IF NOT EXISTS idx_mediaitem_year ON ${SQLITE_MEDIAITEM_TABLE} (year)`,
  `CREATE INDEX IF NOT EXISTS idx_mediaitem_show_slot ON ${SQLITE_MEDIAITEM_TABLE} (showTitle, seasonNumber, episodeNumber)`,
]

export interface CatalogSyncSummary {
  movies: number
  shows: number
  episodes: number
  upserts: number
  startedAt: string
  finishedAt: string
}

export interface CatalogSyncProgress {
  isRunning: boolean
  phase: 'idle' | 'movies' | 'shows' | 'episodes' | 'finalizing' | 'error'
  movies: number
  shows: number
  episodes: number
  upserts: number
  startedAt: string | null
  updatedAt: string
  error: string | null
}

let syncPromise: Promise<CatalogSyncSummary> | null = null

function buildProgress(partial?: Partial<CatalogSyncProgress>): CatalogSyncProgress {
  return {
    isRunning: false,
    phase: 'idle',
    movies: 0,
    shows: 0,
    episodes: 0,
    upserts: 0,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    error: null,
    ...partial,
  }
}

async function saveSyncProgress(progress: CatalogSyncProgress): Promise<void> {
  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_SYNC_PROGRESS_KEY,
      },
    },
    update: { settingValue: toJson(progress) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: PLEX_CATALOG_SYNC_PROGRESS_KEY,
      settingValue: toJson(progress),
    },
  })
}

export async function ensureMediaCatalogIndexes(): Promise<void> {
  for (const stmt of INDEX_STATEMENTS) {
    await prisma.$executeRawUnsafe(stmt)
  }
}

async function saveCatalogSyncState(summary: CatalogSyncSummary): Promise<void> {
  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_LAST_SYNC_KEY,
      },
    },
    update: { settingValue: summary.finishedAt },
    create: { stationId: CATALOG_STATE_STATION_ID, settingKey: PLEX_CATALOG_LAST_SYNC_KEY, settingValue: summary.finishedAt },
  })

  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_LAST_SUMMARY_KEY,
      },
    },
    update: { settingValue: toJson(summary) },
    create: { stationId: CATALOG_STATE_STATION_ID, settingKey: PLEX_CATALOG_LAST_SUMMARY_KEY, settingValue: toJson(summary) },
  })
}

export async function getCatalogStatus(): Promise<{
  lastSyncAt: string | null
  lastSummary: CatalogSyncSummary | null
  syncProgress: CatalogSyncProgress
}> {
  const prefs = await prisma.adminPreference.findMany({
    where: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: {
        in: [
          PLEX_CATALOG_LAST_SYNC_KEY,
          PLEX_CATALOG_LAST_SUMMARY_KEY,
          PLEX_CATALOG_SYNC_PROGRESS_KEY,
        ],
      },
    },
  })

  const lastSyncAt = prefs.find((p) => p.settingKey === PLEX_CATALOG_LAST_SYNC_KEY)?.settingValue ?? null
  const summaryRaw = prefs.find((p) => p.settingKey === PLEX_CATALOG_LAST_SUMMARY_KEY)?.settingValue ?? null
  const lastSummary = summaryRaw ? (JSON.parse(summaryRaw) as CatalogSyncSummary) : null
  const progressRaw = prefs.find((p) => p.settingKey === PLEX_CATALOG_SYNC_PROGRESS_KEY)?.settingValue ?? null
  const syncProgress = progressRaw ? (JSON.parse(progressRaw) as CatalogSyncProgress) : buildProgress()

  return { lastSyncAt, lastSummary, syncProgress }
}

export async function shouldSyncCatalog(maxAgeHours: number): Promise<boolean> {
  const status = await getCatalogStatus()
  if (!status.lastSyncAt) return true
  const last = new Date(status.lastSyncAt)
  if (Number.isNaN(last.getTime())) return true
  return Date.now() - last.getTime() > maxAgeHours * 60 * 60 * 1000
}

export async function getCatalogAutoSyncMaxAgeHours(): Promise<number> {
  const pref = await prisma.adminPreference.findFirst({
    where: {
      stationId: null,
      settingKey: PLEX_CATALOG_AUTO_SYNC_MAX_AGE_HOURS_KEY,
    },
  })

  const parsed = fromJson<number>(pref?.settingValue, DEFAULT_PLEX_CATALOG_AUTO_SYNC_MAX_AGE_HOURS)
  if (!Number.isFinite(parsed)) return DEFAULT_PLEX_CATALOG_AUTO_SYNC_MAX_AGE_HOURS
  return Math.max(1, Math.min(24 * 30, Math.round(parsed)))
}

export async function saveCatalogAutoSyncMaxAgeHours(hours: number): Promise<number> {
  const normalized = Math.max(1, Math.min(24 * 30, Math.round(hours)))
  const existing = await prisma.adminPreference.findFirst({
    where: {
      stationId: null,
      settingKey: PLEX_CATALOG_AUTO_SYNC_MAX_AGE_HOURS_KEY,
    },
  })

  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: toJson(normalized) },
    })
  } else {
    await prisma.adminPreference.create({
      data: {
        stationId: null,
        settingKey: PLEX_CATALOG_AUTO_SYNC_MAX_AGE_HOURS_KEY,
        settingValue: toJson(normalized),
      },
    })
  }

  return normalized
}

export async function getCatalogSelectedLibraryKeys(): Promise<string[]> {
  const pref = await prisma.adminPreference.findUnique({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_SELECTED_LIBRARY_KEYS,
      },
    },
  })

  const parsed = fromJson<string[]>(pref?.settingValue, [])
  if (!Array.isArray(parsed)) return []
  return Array.from(new Set(parsed.map((key) => String(key).trim()).filter(Boolean)))
}

export async function saveCatalogSelectedLibraryKeys(keys: string[]): Promise<string[]> {
  const normalized = Array.from(new Set((keys ?? []).map((key) => String(key).trim()).filter(Boolean)))
  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_SELECTED_LIBRARY_KEYS,
      },
    },
    update: { settingValue: toJson(normalized) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: PLEX_CATALOG_SELECTED_LIBRARY_KEYS,
      settingValue: toJson(normalized),
    },
  })
  return normalized
}

export async function getCatalogLibraryClassifications(): Promise<Record<string, LibraryClass>> {
  const pref = await prisma.adminPreference.findUnique({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_LIBRARY_CLASSIFICATIONS,
      },
    },
  })

  const parsed = fromJson<Record<string, unknown>>(pref?.settingValue, {})
  const out: Record<string, LibraryClass> = {}
  for (const [key, value] of Object.entries(parsed ?? {})) {
    const normalizedKey = String(key).trim()
    if (!normalizedKey) continue
    out[normalizedKey] = normalizeLibraryClass(value)
  }
  return out
}

export async function saveCatalogLibraryClassifications(
  map: Record<string, unknown>,
): Promise<Record<string, LibraryClass>> {
  const normalized: Record<string, LibraryClass> = {}
  for (const [key, value] of Object.entries(map ?? {})) {
    const normalizedKey = String(key).trim()
    if (!normalizedKey) continue
    normalized[normalizedKey] = normalizeLibraryClass(value)
  }

  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_LIBRARY_CLASSIFICATIONS,
      },
    },
    update: { settingValue: toJson(normalized) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: PLEX_CATALOG_LIBRARY_CLASSIFICATIONS,
      settingValue: toJson(normalized),
    },
  })

  return normalized
}

async function getActiveCatalogPlexKeys(): Promise<Set<string>> {
  const pref = await prisma.adminPreference.findUnique({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_ACTIVE_PLEX_KEYS,
      },
    },
  })
  const parsed = fromJson<string[]>(pref?.settingValue, [])
  if (!Array.isArray(parsed) || !parsed.length) return new Set<string>()
  return new Set(parsed.map((key) => String(key).trim()).filter(Boolean))
}

async function saveActiveCatalogPlexKeys(keys: string[]): Promise<void> {
  const normalized = Array.from(new Set((keys ?? []).map((key) => String(key).trim()).filter(Boolean)))
  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_ACTIVE_PLEX_KEYS,
      },
    },
    update: { settingValue: toJson(normalized) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: PLEX_CATALOG_ACTIVE_PLEX_KEYS,
      settingValue: toJson(normalized),
    },
  })
}

function normalizePlexItem(item: PlexMediaItem): PlexMediaItem {
  return {
    ...item,
    genres: (item.genres ?? []).map((g) => String(g).toLowerCase()).filter(Boolean),
    languages: (item.languages ?? []).map((l) => String(l).toLowerCase()).filter(Boolean),
    contentRating: item.contentRating || 'PG',
    durationMins: Math.max(0, Number(item.durationMins ?? 0)),
  }
}

async function upsertCatalogItem(item: PlexMediaItem): Promise<void> {
  const normalized = normalizePlexItem(item)
  await prisma.mediaItem.upsert({
    where: { plexKey: normalized.ratingKey },
    update: {
      title: normalized.title,
      type: normalized.type,
      year: normalized.year,
      durationMins: normalized.durationMins,
      genres: normalized.genres.join(','),
      ratings: normalized.contentRating,
      parentPlexKey: normalized.showPlexKey,
      showTitle: normalized.showTitle,
      seasonNumber: normalized.seasonNumber,
      episodeNumber: normalized.episodeNumber,
      chapters: normalized.chapters ? toJson(normalized.chapters) : null,
    },
    create: {
      plexKey: normalized.ratingKey,
      title: normalized.title,
      type: normalized.type,
      year: normalized.year,
      durationMins: normalized.durationMins,
      genres: normalized.genres.join(','),
      ratings: normalized.contentRating,
      parentPlexKey: normalized.showPlexKey,
      showTitle: normalized.showTitle,
      seasonNumber: normalized.seasonNumber,
      episodeNumber: normalized.episodeNumber,
      chapters: normalized.chapters ? toJson(normalized.chapters) : undefined,
    },
  })

  await prisma.$executeRaw`
    UPDATE "MediaItem"
    SET "languages" = ${normalized.languages?.join(',') || null},
        "parentPlexKey" = ${normalized.showPlexKey || null}
    WHERE "plexKey" = ${normalized.ratingKey}
  `
}

export async function syncPlexCatalog(
  plex: PlexClient,
  opts?: { selectedLibraryKeys?: string[] },
): Promise<CatalogSyncSummary> {
  await ensureMediaCatalogIndexes()

  const startedAt = new Date().toISOString()
  let movies = 0
  let shows = 0
  let episodes = 0
  let upserts = 0
  const selectedLibraryKeys = Array.from(new Set((opts?.selectedLibraryKeys ?? []).map((key) => String(key).trim()).filter(Boolean)))
  const libraryClassifications = await getCatalogLibraryClassifications()
  const activePlexKeys = new Set<string>()
  const activeClassByPlexKey: Record<string, LibraryClass> = {}

  const progressBase = buildProgress({
    isRunning: true,
    phase: 'movies',
    startedAt,
  })
  await saveSyncProgress(progressBase)

  const movieItems = await plex.searchMovies({ sectionKeys: selectedLibraryKeys }).catch(() => [])
  for (const movie of movieItems) {
    await upsertCatalogItem(movie)
    activePlexKeys.add(movie.ratingKey)
    if (movie.sourceSectionKey) {
      activeClassByPlexKey[movie.ratingKey] = libraryClassifications[movie.sourceSectionKey] ?? 'movies'
    }
    movies += 1
    upserts += 1
    if (upserts % 25 === 0) {
      await saveSyncProgress(buildProgress({
        ...progressBase,
        phase: 'movies',
        movies,
        shows,
        episodes,
        upserts,
        isRunning: true,
        startedAt,
      }))
    }
  }

  await saveSyncProgress(buildProgress({
    ...progressBase,
    phase: 'shows',
    movies,
    shows,
    episodes,
    upserts,
    isRunning: true,
    startedAt,
  }))

  const showItems = await plex.searchShows({ sectionKeys: selectedLibraryKeys }).catch(() => [])
  for (const show of showItems) {
    await upsertCatalogItem(show)
    activePlexKeys.add(show.ratingKey)
    if (show.sourceSectionKey) {
      activeClassByPlexKey[show.ratingKey] = libraryClassifications[show.sourceSectionKey] ?? 'tv_shows'
    }
    shows += 1
    upserts += 1

    await saveSyncProgress(buildProgress({
      ...progressBase,
      phase: 'episodes',
      movies,
      shows,
      episodes,
      upserts,
      isRunning: true,
      startedAt,
    }))

    const refs = await plex.getEpisodeList(show.ratingKey).catch(() => [])
    for (const ref of refs) {
      const episode = await plex.getItemByKey(ref.ratingKey).catch(() => null)
      if (!episode) continue
      await upsertCatalogItem(episode)
      activePlexKeys.add(episode.ratingKey)
      activeClassByPlexKey[episode.ratingKey] = activeClassByPlexKey[show.ratingKey] ?? 'tv_shows'
      episodes += 1
      upserts += 1
      if (upserts % 25 === 0) {
        await saveSyncProgress(buildProgress({
          ...progressBase,
          phase: 'episodes',
          movies,
          shows,
          episodes,
          upserts,
          isRunning: true,
          startedAt,
        }))
      }
    }
  }

  await saveSyncProgress(buildProgress({
    ...progressBase,
    phase: 'finalizing',
    movies,
    shows,
    episodes,
    upserts,
    isRunning: true,
    startedAt,
  }))

  const summary: CatalogSyncSummary = {
    movies,
    shows,
    episodes,
    upserts,
    startedAt,
    finishedAt: new Date().toISOString(),
  }

  await saveCatalogSyncState(summary)
  await saveActiveCatalogPlexKeys(Array.from(activePlexKeys))
  await saveActiveClassByPlexKey(activeClassByPlexKey)
  await saveSyncProgress(buildProgress({
    isRunning: false,
    phase: 'idle',
    movies,
    shows,
    episodes,
    upserts,
    startedAt,
  }))
  return summary
}

export function isCatalogSyncRunning(): boolean {
  return !!syncPromise
}

export async function triggerCatalogSync(plex: PlexClient): Promise<{ started: boolean }> {
  if (syncPromise) return { started: false }

  syncPromise = (async () => {
    try {
      const selectedLibraryKeys = await getCatalogSelectedLibraryKeys()
      return await syncPlexCatalog(plex, { selectedLibraryKeys })
    } catch (err: any) {
      await saveSyncProgress(buildProgress({
        isRunning: false,
        phase: 'error',
        error: String(err?.message ?? err ?? 'Unknown catalog sync error'),
        startedAt: new Date().toISOString(),
      }))
      throw err
    } finally {
      syncPromise = null
    }
  })()

  return { started: true }
}

interface CatalogPickFilters {
  allowGenres: string[]
  denyGenres: string[]
  allowLanguages?: string[]
  denyLanguages?: string[]
  type: 'movie' | 'show'
}

export interface CatalogSearchItem {
  plexKey: string
  title: string
  type: 'movie' | 'show'
  year: number
}

export interface CatalogEpisodeRef {
  season: number
  episode: number
  ratingKey: string
}

interface CatalogMediaRow {
  plexKey: string
  title: string
  type: string
  year: number
  durationMins: number
  genres: string | null
  languages: string | null
  ratings: string
  parentPlexKey: string | null
  showTitle: string | null
  seasonNumber: number | null
  episodeNumber: number | null
  chapters: string | null
  scheduledCount: number
  lastScheduled: Date | null
}

function parseCsvList(value: string | null | undefined): string[] {
  return String(value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
}

export interface CatalogFilterOption {
  value: string
  count: number
}

function mapCatalogRow(row: CatalogMediaRow): PlexMediaItem {
  return {
    ratingKey: row.plexKey,
    title: row.title,
    type: row.type as PlexMediaItem['type'],
    year: row.year,
    durationMs: row.durationMins * 60_000,
    durationMins: row.durationMins,
    genres: parseCsvList(row.genres),
    languages: parseCsvList(row.languages),
    contentRating: row.ratings,
    scheduledCount: row.scheduledCount,
    lastScheduledAt: row.lastScheduled,
    showPlexKey: row.parentPlexKey ?? undefined,
    showTitle: row.showTitle ?? undefined,
    seasonNumber: row.seasonNumber ?? undefined,
    episodeNumber: row.episodeNumber ?? undefined,
    chapters: row.chapters ? (JSON.parse(row.chapters) as Array<{ title: string; startOffsetMs: number }>) : undefined,
  }
}

function ratingToRank(rating: string): number {
  const r = String(rating || '').toUpperCase().trim()
  if (!r) return 1

  const normalized = r
    .replace(/^.*\//, '')
    .replace(/\s+/g, '')
    .replace(/-/g, '')

  if (normalized === 'G') return 0
  if (normalized === 'PG') return 1
  if (normalized === 'M') return 2
  if (normalized === 'MA15+' || normalized === 'MA15') return 3

  // Broader international mappings so catalog-only mode does not starve pools.
  if (normalized === 'TVY' || normalized === 'TVY7') return 0
  if (normalized === 'TVG') return 0
  if (normalized === 'TVPG' || normalized === 'PG13') return 1
  if (normalized === 'TV14' || normalized === 'R18+' || normalized === 'R18') return 3
  if (normalized === 'R' || normalized === 'NC17' || normalized === 'X18+' || normalized === 'X18') return 3

  if (normalized.includes('MA15')) return 3
  if (normalized === 'M15+' || normalized === 'M15') return 3
  if (normalized.startsWith('M')) return 2
  if (normalized.startsWith('PG')) return 1
  if (normalized.startsWith('G')) return 0

  // Treat unknown ratings as mid-tier so they can still be considered under M/MA blocks.
  return 2
}

export async function getCatalogCandidates(filters: CatalogPickFilters): Promise<PlexMediaItem[]> {
  const activeKeys = await getActiveCatalogPlexKeys()
  const activeClassByPlexKey = await getActiveClassByPlexKey()
  const rows = await prisma.$queryRaw<CatalogMediaRow[]>`
    SELECT
      "plexKey",
      "title",
      "type",
      "year",
      "durationMins",
      "genres",
      "languages",
      "ratings",
      "parentPlexKey",
      "showTitle",
      "seasonNumber",
      "episodeNumber",
      "chapters",
      "scheduledCount",
      "lastScheduled"
    FROM "MediaItem"
    WHERE "type" = ${filters.type}
  `
  const allow = filters.allowGenres.map((g) => g.toLowerCase())
  const deny = filters.denyGenres.map((g) => g.toLowerCase())
  const allowLanguages = (filters.allowLanguages ?? []).map((language) => language.toLowerCase())
  const denyLanguages = (filters.denyLanguages ?? []).map((language) => language.toLowerCase())

  return rows
    .filter((row) => !activeKeys.size || activeKeys.has(row.plexKey))
    .filter((row) => {
      const genres = parseCsvList(row.genres)
      const languages = parseCsvList(row.languages)
      if (allow.length && !allow.some((g) => genres.includes(g))) return false
      if (deny.some((g) => genres.includes(g))) return false
      if (allowLanguages.length && !allowLanguages.some((language) => languages.includes(language))) return false
      if (denyLanguages.some((language) => languages.includes(language))) return false
      return true
    })
    .sort((a, b) => {
      const classA = activeClassByPlexKey[a.plexKey]
      const classB = activeClassByPlexKey[b.plexKey]
      const scoreA = classGuidanceScore(classA, filters.type)
      const scoreB = classGuidanceScore(classB, filters.type)
      if (scoreA !== scoreB) return scoreB - scoreA
      return 0
    })
    .map(mapCatalogRow)
}

export async function getCatalogEpisodeList(showPlexKey: string): Promise<CatalogEpisodeRef[]> {
  const activeKeys = await getActiveCatalogPlexKeys()
  const showRow = await prisma.mediaItem.findUnique({
    where: { plexKey: showPlexKey },
    select: { title: true },
  })

  const rows = await prisma.$queryRaw<CatalogMediaRow[]>`
    SELECT
      "plexKey",
      "title",
      "type",
      "year",
      "durationMins",
      "genres",
      "languages",
      "ratings",
      "parentPlexKey",
      "showTitle",
      "seasonNumber",
      "episodeNumber",
      "chapters",
      "scheduledCount",
      "lastScheduled"
    FROM "MediaItem"
    WHERE "type" = 'episode'
      AND (
        "parentPlexKey" = ${showPlexKey}
        OR (
          "parentPlexKey" IS NULL
          AND ${showRow?.title ?? null} IS NOT NULL
          AND "showTitle" = ${showRow?.title ?? null}
        )
      )
    ORDER BY "seasonNumber" ASC, "episodeNumber" ASC
  `

  return rows
    .filter((row) => !activeKeys.size || activeKeys.has(row.plexKey))
    .filter((row) => row.seasonNumber != null && row.episodeNumber != null)
    .map((row) => ({
      season: row.seasonNumber as number,
      episode: row.episodeNumber as number,
      ratingKey: row.plexKey,
    }))
}

export async function getCatalogEpisode(
  showPlexKey: string,
  season: number,
  episode: number,
): Promise<PlexMediaItem | null> {
  const activeKeys = await getActiveCatalogPlexKeys()
  const showRow = await prisma.mediaItem.findUnique({
    where: { plexKey: showPlexKey },
    select: { title: true },
  })

  const rows = await prisma.$queryRaw<CatalogMediaRow[]>`
    SELECT
      "plexKey",
      "title",
      "type",
      "year",
      "durationMins",
      "genres",
      "languages",
      "ratings",
      "parentPlexKey",
      "showTitle",
      "seasonNumber",
      "episodeNumber",
      "chapters",
      "scheduledCount",
      "lastScheduled"
    FROM "MediaItem"
    WHERE "type" = 'episode'
      AND (
        "parentPlexKey" = ${showPlexKey}
        OR (
          "parentPlexKey" IS NULL
          AND ${showRow?.title ?? null} IS NOT NULL
          AND "showTitle" = ${showRow?.title ?? null}
        )
      )
      AND "seasonNumber" = ${season}
      AND "episodeNumber" = ${episode}
    LIMIT 1
  `

  const match = rows.find((row) => !activeKeys.size || activeKeys.has(row.plexKey))
  return match ? mapCatalogRow(match) : null
}

export async function getCatalogFilterOptions(): Promise<{
  genres: CatalogFilterOption[]
  languages: CatalogFilterOption[]
}> {
  const rows = await prisma.$queryRaw<Array<{ genres: string | null; languages: string | null }>>`
    SELECT "genres", "languages"
    FROM "MediaItem"
  `

  const genreCounts = new Map<string, number>()
  const languageCounts = new Map<string, number>()

  for (const row of rows) {
    for (const genre of parseCsvList(row.genres)) {
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1)
    }
    for (const language of parseCsvList(row.languages)) {
      languageCounts.set(language, (languageCounts.get(language) ?? 0) + 1)
    }
  }

  const toSortedList = (counts: Map<string, number>) =>
    Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))

  return {
    genres: toSortedList(genreCounts),
    languages: toSortedList(languageCounts),
  }
}

export function applyRatingCeiling(items: PlexMediaItem[], ceiling: string): PlexMediaItem[] {
  const maxRank = ratingToRank(ceiling)
  return items.filter((item) => ratingToRank(item.contentRating) <= maxRank)
}

export async function getBlockedPlexKeys(): Promise<string[]> {
  const pref = await prisma.adminPreference.findUnique({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_BLOCKED_KEYS,
      },
    },
  })

  if (!pref?.settingValue) return []
  const parsed = JSON.parse(pref.settingValue)
  if (!Array.isArray(parsed)) return []
  return parsed.map((x) => String(x)).filter(Boolean)
}

export async function setBlockedPlexKeys(keys: string[]): Promise<void> {
  const deduped = Array.from(new Set(keys.map((k) => String(k)).filter(Boolean)))
  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_BLOCKED_KEYS,
      },
    },
    update: { settingValue: toJson(deduped) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: PLEX_CATALOG_BLOCKED_KEYS,
      settingValue: toJson(deduped),
    },
  })
}

export async function addBlockedPlexKey(plexKey: string): Promise<void> {
  const keys = await getBlockedPlexKeys()
  await setBlockedPlexKeys([...keys, plexKey])
}

export async function removeBlockedPlexKey(plexKey: string): Promise<void> {
  const keys = await getBlockedPlexKeys()
  await setBlockedPlexKeys(keys.filter((k) => k !== plexKey))
}

export async function listBlockedCatalogItems(): Promise<CatalogSearchItem[]> {
  const keys = await getBlockedPlexKeys()
  if (!keys.length) return []

  const rows = await prisma.mediaItem.findMany({
    where: { plexKey: { in: keys } },
    orderBy: { title: 'asc' },
  })

  return rows
    .filter((row) => row.type === 'movie' || row.type === 'show')
    .map((row) => ({
      plexKey: row.plexKey,
      title: row.title,
      type: row.type as 'movie' | 'show',
      year: row.year,
    }))
}

export async function searchCatalogMedia(
  query: string,
  type: 'movie' | 'show' | 'all' = 'all',
  limit = 25,
): Promise<CatalogSearchItem[]> {
  const whereType = type === 'all' ? ['movie', 'show'] : [type]
  const rows = await prisma.mediaItem.findMany({
    where: {
      type: { in: whereType },
      title: query ? { contains: query } : undefined,
    },
    orderBy: { title: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
  })

  return rows
    .filter((row) => row.type === 'movie' || row.type === 'show')
    .map((row) => ({
      plexKey: row.plexKey,
      title: row.title,
      type: row.type as 'movie' | 'show',
      year: row.year,
    }))
}

type HolidayTagMap = Record<string, string[]>

export async function getHolidayTagMap(): Promise<HolidayTagMap> {
  const pref = await prisma.adminPreference.findUnique({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_HOLIDAY_TAGS,
      },
    },
  })

  if (!pref?.settingValue) return {}
  const parsed = JSON.parse(pref.settingValue) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const out: HolidayTagMap = {}
  for (const [holiday, keys] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(keys)) continue
    out[holiday] = Array.from(new Set(keys.map((x) => String(x)).filter(Boolean)))
  }
  return out
}

export async function setHolidayTagMap(map: HolidayTagMap): Promise<void> {
  const normalized: HolidayTagMap = {}
  for (const [holiday, keys] of Object.entries(map)) {
    normalized[holiday] = Array.from(new Set((keys || []).map((x) => String(x)).filter(Boolean)))
  }

  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_HOLIDAY_TAGS,
      },
    },
    update: { settingValue: toJson(normalized) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: PLEX_CATALOG_HOLIDAY_TAGS,
      settingValue: toJson(normalized),
    },
  })
}

export async function getHolidayTaggedKeys(holidayName: string): Promise<string[]> {
  const map = await getHolidayTagMap()
  return map[holidayName] ?? []
}

export async function addHolidayTag(holidayName: string, plexKey: string): Promise<void> {
  const map = await getHolidayTagMap()
  const current = map[holidayName] ?? []
  map[holidayName] = Array.from(new Set([...current, plexKey]))
  await setHolidayTagMap(map)
}

export async function removeHolidayTag(holidayName: string, plexKey: string): Promise<void> {
  const map = await getHolidayTagMap()
  map[holidayName] = (map[holidayName] ?? []).filter((key) => key !== plexKey)
  await setHolidayTagMap(map)
}

export async function listHolidayTaggedItems(holidayName: string): Promise<CatalogSearchItem[]> {
  const keys = await getHolidayTaggedKeys(holidayName)
  if (!keys.length) return []

  const rows = await prisma.mediaItem.findMany({
    where: {
      plexKey: { in: keys },
      type: { in: ['movie', 'show'] },
    },
    orderBy: { title: 'asc' },
  })

  return rows.map((row) => ({
    plexKey: row.plexKey,
    title: row.title,
    type: row.type as 'movie' | 'show',
    year: row.year,
  }))
}

export async function getActiveClassByPlexKey(): Promise<Record<string, LibraryClass>> {
  const pref = await prisma.adminPreference.findUnique({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_ACTIVE_CLASS_BY_PLEX_KEY,
      },
    },
  })
  const parsed = fromJson<Record<string, unknown>>(pref?.settingValue, {})
  const out: Record<string, LibraryClass> = {}
  for (const [key, value] of Object.entries(parsed ?? {})) {
    const normalizedKey = String(key).trim()
    if (!normalizedKey) continue
    out[normalizedKey] = normalizeLibraryClass(value)
  }
  return out
}

async function saveActiveClassByPlexKey(map: Record<string, LibraryClass>): Promise<void> {
  const normalized: Record<string, LibraryClass> = {}
  for (const [key, value] of Object.entries(map ?? {})) {
    const normalizedKey = String(key).trim()
    if (!normalizedKey) continue
    normalized[normalizedKey] = normalizeLibraryClass(value)
  }

  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: PLEX_CATALOG_ACTIVE_CLASS_BY_PLEX_KEY,
      },
    },
    update: { settingValue: toJson(normalized) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: PLEX_CATALOG_ACTIVE_CLASS_BY_PLEX_KEY,
      settingValue: toJson(normalized),
    },
  })
}