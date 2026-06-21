// Scheduling Engine
// Generates 2-week rolling broadcast schedules for all stations.
// Runs on server startup via setInterval (instrumentation.ts).
// Also callable manually via POST /api/scheduler/run.
//
// Algorithm per station × day:
//   1. Skip if already scheduled
//   2. Detect holiday — apply override genres if applicable
//   3. Pick the right time-block template (weekday / weekend)
//   4. For each block: select content, handle episode pointers, calc ad breaks + filler
//   5. Write Schedule + Slot rows to DB

import { prisma }                        from './db'
import { getHolidayForDate, loadHolidaySettings }             from './holidays'
import { PlexClient, type PlexMediaItem }                    from './plex-client'
import { syncPlexCatalog, shouldSyncCatalog, getCatalogAutoSyncMaxAgeHours, getCatalogCandidates, getCatalogEpisode, getCatalogEpisodeList, applyRatingCeiling, getBlockedPlexKeys, getHolidayTagMap } from './plex-catalog'
import { toJson, fromJsonObject }        from './json'
import { addDays, startOfDay, getDay, differenceInMinutes, addMinutes, differenceInCalendarDays } from 'date-fns'
import { readFile } from 'fs/promises'
import path from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimeBlock {
  name:          string
  startHour:     number
  startMin:      number
  endHour:       number
  endMin:        number
  // What kind of content belongs here
  contentType:   'movie' | 'episode' | 'mixed' | 'filler' | 'news'
  // Maximum content rating allowed in this block
  ratingCeiling: 'G' | 'PG' | 'M' | 'MA15+'
}

interface StationRules {
  allow_genres:       string[]
  deny_genres:        string[]
  allow_languages:    string[]
  deny_languages:     string[]
  ad_policy: {
    enabled:            boolean
    break_interval_tv:  number  // minutes between TV ad breaks
    break_interval_movie: number
  }
}

interface StationTimeBlockSpec {
  name: string
  day: string
  start: string
  end: string
  content_source: string
}

interface EffectiveStationBlock {
  name: string
  day: string
  startMins: number
  endMins: number
  contentType: TimeBlock['contentType']
}

interface OriginalStationProfile {
  rules?: {
    time_blocks?: StationTimeBlockSpec[]
  }
}

interface EpisodeSnapshotItem {
  season: number
  episode: number
  ratingKey: string
  title: string
  durationMins: number
  contentRating: string
  year: number
  showTitle?: string
  type: 'episode'
  genres: string[]
  seasonNumber: number
  episodeNumber: number
  showPlexKey?: string
  chapters?: Array<{ title: string; startOffsetMs: number }>
}

let originalStationProfileCache: Record<string, OriginalStationProfile> | null = null

interface ResolvedHolidayConfig {
  replace_schedule: boolean
  ad_free: boolean
  content_priority: string[]
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => String(v).trim())
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeStationRules(raw: unknown): StationRules {
  const r = (raw ?? {}) as Record<string, unknown>
  const ad = (r.ad_policy ?? {}) as Record<string, unknown>

  return {
    allow_genres: asStringArray(r.allow_genres),
    deny_genres: asStringArray(r.deny_genres),
    allow_languages: asStringArray(r.allow_languages),
    deny_languages: asStringArray(r.deny_languages),
    ad_policy: {
      enabled: Boolean(ad.enabled),
      break_interval_tv: Number(ad.break_interval_tv ?? 15),
      break_interval_movie: Number(ad.break_interval_movie ?? 30),
    },
  }
}

async function getOriginalStationProfiles(): Promise<Record<string, OriginalStationProfile>> {
  if (originalStationProfileCache) return originalStationProfileCache

  try {
    const configPath = path.join(process.cwd(), 'config', 'stations.json')
    const raw = await readFile(configPath, 'utf8')
    const parsed = JSON.parse(raw) as { stations?: Record<string, OriginalStationProfile> }
    originalStationProfileCache = parsed?.stations ?? {}
  } catch {
    originalStationProfileCache = {}
  }

  return originalStationProfileCache
}

function parseEpisodeSnapshot(value: unknown): EpisodeSnapshotItem[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    const out: EpisodeSnapshotItem[] = []
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const season = Number(entry.season)
      const episode = Number(entry.episode)
      const ratingKey = String(entry.ratingKey ?? '').trim()
      const title = String(entry.title ?? '').trim()
      const durationMins = Number(entry.durationMins ?? 0)
      const contentRating = String(entry.contentRating ?? 'PG').trim() || 'PG'
      const year = Number(entry.year ?? 0)
      const showTitle = entry.showTitle == null ? undefined : String(entry.showTitle)
      if (!Number.isFinite(season) || !Number.isFinite(episode) || !ratingKey || !title || !Number.isFinite(durationMins) || !Number.isFinite(year)) continue
      out.push({ season, episode, ratingKey, title, durationMins, contentRating, year, showTitle, type: 'episode', genres: [], seasonNumber: season, episodeNumber: episode })
    }
    return out.sort((a, b) => a.season - b.season || a.episode - b.episode)
  } catch {
    return []
  }
}

function snapshotEpisode(episode: PlexMediaItem): EpisodeSnapshotItem {
  return {
    season: episode.seasonNumber ?? 0,
    episode: episode.episodeNumber ?? 0,
    ratingKey: episode.ratingKey,
    title: episode.title,
    durationMins: episode.durationMins,
    contentRating: episode.contentRating,
    year: episode.year,
    showTitle: episode.showTitle ?? undefined,
    type: 'episode',
    genres: episode.genres ?? [],
    seasonNumber: episode.seasonNumber ?? episode.seasonNumber ?? 0,
    episodeNumber: episode.episodeNumber ?? episode.episodeNumber ?? 0,
    showPlexKey: episode.showPlexKey,
    chapters: episode.chapters,
  }
}

async function buildEpisodeSnapshotList(showPlexKey: string): Promise<EpisodeSnapshotItem[]> {
  const refs = await getCatalogEpisodeList(showPlexKey).catch(() => [])
  const snapshots: EpisodeSnapshotItem[] = []

  for (const ref of refs) {
    const episode = await getCatalogEpisode(showPlexKey, ref.season, ref.episode).catch(() => null)
    if (episode) snapshots.push(snapshotEpisode(episode))
  }

  return snapshots.sort((a, b) => a.season - b.season || a.episode - b.episode)
}

function parseClockToMinutes(value: string): number | null {
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 24 || mm < 0 || mm > 59) return null
  if (hh === 24 && mm !== 0) return null
  return hh * 60 + mm
}

function normalizeDayName(day: string): string {
  return String(day).trim().toLowerCase()
}

function dayNameForDate(date: Date): string {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][getDay(date)]
}

function mapStationContentType(spec: StationTimeBlockSpec): TimeBlock['contentType'] {
  const source = String(spec.content_source ?? '').toLowerCase()
  // Keep schedule generation Plex-catalog-only even if legacy config marks a block as YouTube.
  if (source === 'youtube') return 'mixed'

  const name = String(spec.name ?? '').toLowerCase()
  if (name.includes('news')) return 'news'
  if (name.includes('movie') || name.includes('blockbuster')) return 'movie'
  if (
    name.includes('drama') ||
    name.includes('sitcom') ||
    name.includes('programming') ||
    name.includes('show') ||
    name.includes('cartoon') ||
    name.includes('youth') ||
    name.includes('kids')
  ) {
    return 'episode'
  }

  return 'mixed'
}

function resolveStationTimeBlocks(
  stationDate: Date,
  rawRules: Record<string, unknown>,
  profile: OriginalStationProfile | undefined,
): EffectiveStationBlock[] {
  const inlineBlocks = Array.isArray(rawRules.time_blocks)
    ? (rawRules.time_blocks as StationTimeBlockSpec[])
    : []
  const profileBlocks = Array.isArray(profile?.rules?.time_blocks)
    ? (profile?.rules?.time_blocks as StationTimeBlockSpec[])
    : []

  const source = inlineBlocks.length ? inlineBlocks : profileBlocks
  if (!source.length) return []

  const todayName = dayNameForDate(stationDate)
  const out: EffectiveStationBlock[] = []

  for (const spec of source) {
    const startMins = parseClockToMinutes(spec.start)
    const endMins = parseClockToMinutes(spec.end)
    if (startMins == null || endMins == null) continue

    const day = normalizeDayName(spec.day || '*')
    if (day !== '*' && day !== todayName) continue

    out.push({
      name: spec.name,
      day,
      startMins,
      endMins,
      contentType: mapStationContentType(spec),
    })
  }

  return out
}

function timeIsInRange(minOfDay: number, startMins: number, endMins: number): boolean {
  if (startMins === endMins) return true
  if (startMins < endMins) {
    return minOfDay >= startMins && minOfDay < endMins
  }
  return minOfDay >= startMins || minOfDay < endMins
}

function getContentTypeForSlot(
  slotStart: Date,
  baseType: TimeBlock['contentType'],
  stationBlocks: EffectiveStationBlock[],
): TimeBlock['contentType'] {
  const normalizeType = (value: TimeBlock['contentType']): TimeBlock['contentType'] =>
    (value === 'filler' || value === 'news') ? 'mixed' : value

  if (!stationBlocks.length) return normalizeType(baseType)
  const mins = slotStart.getHours() * 60 + slotStart.getMinutes()
  const matches = stationBlocks.filter((block) => timeIsInRange(mins, block.startMins, block.endMins))
  if (!matches.length) return normalizeType(baseType)

  // Narrower windows (e.g. Play School inside Children's Programming) win.
  const spanMins = (block: EffectiveStationBlock) => {
    if (block.startMins === block.endMins) return 24 * 60
    if (block.startMins < block.endMins) return block.endMins - block.startMins
    return 24 * 60 - block.startMins + block.endMins
  }

  matches.sort((a, b) => spanMins(a) - spanMins(b))
  return normalizeType(matches[0]?.contentType ?? baseType)
}

function getGenreHintsForBlockName(blockName: string): string[] {
  const name = String(blockName || '').toLowerCase()
  const hints = new Set<string>()

  if (name.includes('kids') || name.includes('children') || name.includes('cartoon') || name.includes('play school')) {
    hints.add('children')
    hints.add('family')
    hints.add('animation')
    hints.add('anime')
  }
  if (name.includes('drama') || name.includes('soap')) {
    hints.add('drama')
    hints.add('japanese-drama')
    hints.add('korean-drama')
    hints.add('uk-drama')
  }
  if (name.includes('sitcom') || name.includes('comedy')) {
    hints.add('sitcom')
    hints.add('comedy')
  }
  if (name.includes('documentary')) hints.add('documentary')
  if (name.includes('teen') || name.includes('youth')) {
    hints.add('teen')
    hints.add('action')
    hints.add('comedy')
  }
  if (name.includes('movie') || name.includes('blockbuster')) {
    hints.add('film')
    hints.add('movie')
  }

  return Array.from(hints)
}

async function loadEpisodeSnapshot(progress: { id: string; plexShowKey: string; episodeOrderJson: string | null }): Promise<EpisodeSnapshotItem[]> {
  const existing = parseEpisodeSnapshot(progress.episodeOrderJson)
  if (existing.length) return existing

  const snapshot = await buildEpisodeSnapshotList(progress.plexShowKey)
  if (!snapshot.length) return []

  await prisma.showProgress.update({
    where: { id: progress.id },
    data: { episodeOrderJson: toJson(snapshot) },
  }).catch(() => null)

  return snapshot
}

async function loadStationCandidates(params: {
  type: 'movie' | 'show'
  allowGenres: string[]
  denyGenres: string[]
  allowLanguages: string[]
  denyLanguages: string[]
}): Promise<PlexMediaItem[]> {
  const strict = await getCatalogCandidates(params).catch(() => [])
  if (strict.length) return strict

  const relaxedGenres = await getCatalogCandidates({
    ...params,
    allowGenres: [],
  }).catch(() => [])
  if (relaxedGenres.length) return relaxedGenres

  return getCatalogCandidates({
    ...params,
    allowGenres: [],
    allowLanguages: [],
  }).catch(() => [])
}

function resolveHolidayConfig(params: {
  holiday: string
  date: Date
  stationId: string
  rows: Array<{
    holidayName: string
    year: number
    stationId: string | null
    replaceSchedule: boolean
    adFree: boolean
    contentPriority: string
  }>
  legacyOverrides: Record<string, any>
}): ResolvedHolidayConfig | null {
  const { holiday, date, stationId, rows, legacyOverrides } = params
  const year = date.getFullYear()

  const stationSpecific = rows.find((row) => row.holidayName === holiday && row.year === year && row.stationId === stationId)
  const globalOverride = rows.find((row) => row.holidayName === holiday && row.year === year && row.stationId == null)
  const dbOverride = stationSpecific ?? globalOverride

  if (dbOverride) {
    return {
      replace_schedule: dbOverride.replaceSchedule,
      ad_free: dbOverride.adFree,
      content_priority: asStringArray(dbOverride.contentPriority),
    }
  }

  const legacy = legacyOverrides[holiday]
  if (!legacy) return null

  return {
    replace_schedule: Boolean(legacy.replace_schedule ?? true),
    ad_free: Boolean(legacy.ad_free ?? false),
    content_priority: asStringArray(legacy.content_priority),
  }
}

// ─── 1990s Australian weekday time-block template ────────────────────────────

const WEEKDAY_BLOCKS: TimeBlock[] = [
  { name: 'Late Movies',        startHour:  0, startMin: 0,  endHour:  2, endMin: 0,  contentType: 'movie',   ratingCeiling: 'MA15+' },
  { name: 'Infomercials',       startHour:  2, startMin: 0,  endHour:  4, endMin: 0,  contentType: 'filler',  ratingCeiling: 'G'     },
  { name: 'Early News/Religion',startHour:  4, startMin: 0,  endHour:  6, endMin: 0,  contentType: 'news',    ratingCeiling: 'G'     },
  { name: 'Breakfast Warm-Up',  startHour:  6, startMin: 0,  endHour:  7, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'G'     },
  { name: 'Kids Cartoons',      startHour:  7, startMin: 0,  endHour:  9, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Morning Lifestyle',  startHour:  9, startMin: 0,  endHour: 11, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'US/UK Reruns',       startHour: 11, startMin: 0,  endHour: 12, endMin: 0,  contentType: 'episode', ratingCeiling: 'PG'    },
  { name: 'Midday Movie',       startHour: 12, startMin: 0,  endHour: 14, endMin: 0,  contentType: 'movie',   ratingCeiling: 'PG'    },
  { name: 'Daytime Soaps',      startHour: 14, startMin: 0,  endHour: 16, endMin: 0,  contentType: 'episode', ratingCeiling: 'PG'    },
  { name: 'After-School TV',    startHour: 16, startMin: 0,  endHour: 18, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Evening News',       startHour: 18, startMin: 0,  endHour: 18, endMin: 30, contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Current Affairs',    startHour: 18, startMin: 30, endHour: 19, endMin: 30, contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Prime Time',         startHour: 19, startMin: 30, endHour: 21, endMin: 30, contentType: 'mixed',   ratingCeiling: 'M'     },
  { name: 'Second-Tier Prime',  startHour: 21, startMin: 30, endHour: 22, endMin: 30, contentType: 'mixed',   ratingCeiling: 'M'     },
  { name: 'Late News',          startHour: 22, startMin: 30, endHour: 23, endMin: 0,  contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Late Night',         startHour: 23, startMin: 0,  endHour: 24, endMin: 0,  contentType: 'episode', ratingCeiling: 'MA15+' },
]

const WEEKEND_BLOCKS: TimeBlock[] = [
  { name: 'Late Movies',        startHour:  0, startMin: 0,  endHour:  2, endMin: 0,  contentType: 'movie',   ratingCeiling: 'MA15+' },
  { name: 'Infomercials',       startHour:  2, startMin: 0,  endHour:  4, endMin: 0,  contentType: 'filler',  ratingCeiling: 'G'     },
  { name: 'Early Morning',      startHour:  4, startMin: 0,  endHour:  6, endMin: 0,  contentType: 'filler',  ratingCeiling: 'G'     },
  { name: 'Kids Cartoons',      startHour:  6, startMin: 0,  endHour: 10, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Sports/Lifestyle',   startHour: 10, startMin: 0,  endHour: 12, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Live Sport',         startHour: 12, startMin: 0,  endHour: 18, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Weekend News',       startHour: 18, startMin: 0,  endHour: 19, endMin: 0,  contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Weekend Movie',      startHour: 19, startMin: 0,  endHour: 22, endMin: 0,  contentType: 'movie',   ratingCeiling: 'M'     },
  { name: 'Music Videos',       startHour: 22, startMin: 0,  endHour: 24, endMin: 0,  contentType: 'filler',  ratingCeiling: 'MA15+' },
]

const RATINGS_ORDER = ['G', 'PG', 'M', 'MA15+']
let schedulerIsRunning = false
const MAX_SERIES_EPISODES_PER_DAY = 2
const EPISODE_PROGRESS_INTERVAL_DAYS = 7

export function isSchedulerRunning(): boolean {
  return schedulerIsRunning
}

// ─── Rating ceiling filter ────────────────────────────────────────────────────

function ratingAllowed(itemRating: string, ceiling: string): boolean {
  const itemIdx    = RATINGS_ORDER.indexOf(itemRating)
  const ceilingIdx = RATINGS_ORDER.indexOf(ceiling)
  if (itemIdx === -1 || ceilingIdx === -1) return true // unknown rating — allow
  return itemIdx <= ceilingIdx
}

// ─── Weighted random selection ────────────────────────────────────────────────

function weightedRandom<T>(items: Array<{ item: T; weight: number }>): T | null {
  if (!items.length) return null
  const total = items.reduce((s, i) => s + i.weight, 0)
  let r = Math.random() * total
  for (const { item, weight } of items) {
    r -= weight
    if (r <= 0) return item
  }
  return items[items.length - 1].item
}

function incrementCount(map: Map<string, number>, key: string | null | undefined): void {
  if (!key) return
  const normalized = key.trim().toLowerCase()
  if (!normalized) return
  map.set(normalized, (map.get(normalized) ?? 0) + 1)
}

function pickMovieCandidate(
  movies: PlexMediaItem[],
  block: TimeBlock,
  remainingMins: number,
  dayTitleCounts: Map<string, number>,
): PlexMediaItem | null {
  const tolerances = [15, 30, 45, 60]
  const pool = tolerances
    .map((tolerance) => movies.filter((movie) => Math.abs(movie.durationMins - remainingMins) <= tolerance))
    .find((candidates) => candidates.length)
    ?? movies

  return weightedRandom(
    pool.map((movie) => {
      const diff = Math.abs(movie.durationMins - remainingMins)
      const repeatPenalty = 1 / (1 + (dayTitleCounts.get(movie.title.toLowerCase()) ?? 0) * 2.5)
      const fitBonus = Math.max(0.2, 2 - diff / 45)

      return {
        item: movie,
        weight: Math.max(0.05, weightForItem(movie, block) * repeatPenalty * fitBonus),
      }
    }),
  )
}

function buildWeightedShowPool(
  shows: PlexMediaItem[],
  block: TimeBlock,
  daySeriesCounts: Map<string, number>,
) {
  return shows.map((show) => {
    const seriesKey = show.title.toLowerCase()
    const repeatPenalty = 1 / (1 + (daySeriesCounts.get(seriesKey) ?? 0) * 3)

    return {
      item: show,
      weight: Math.max(0.05, weightForItem(show, block) * repeatPenalty),
    }
  })
}

function shouldTryMovieInMixedBlock(params: {
  remainingMins: number
  validMovies: number
  validShows: number
  daySeriesCounts: Map<string, number>
}): boolean {
  const { remainingMins, validMovies, validShows, daySeriesCounts } = params
  if (!validMovies || remainingMins < 75) return false
  if (!validShows) return true

  const totalSeriesUsesToday = Array.from(daySeriesCounts.values()).reduce((sum, count) => sum + count, 0)
  return remainingMins >= 120 || totalSeriesUsesToday >= 4
}

async function buildShowOwnershipMap(): Promise<Map<string, string>> {
  const rows = await prisma.showProgress.findMany({
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
    select: {
      plexShowKey: true,
      stationId: true,
    },
  })

  const owners = new Map<string, string>()
  for (const row of rows) {
    if (!owners.has(row.plexShowKey)) {
      owners.set(row.plexShowKey, row.stationId)
    }
  }
  return owners
}

function showIsOwnedByStation(
  showOwnership: Map<string, string>,
  plexShowKey: string,
  stationId: string,
): boolean {
  const owner = showOwnership.get(plexShowKey)
  return !owner || owner === stationId
}

// ─── Ad break calculator ──────────────────────────────────────────────────────

function buildAdBreaks(
  contentDurationMins: number,
  intervalMins: number,
  enabled: boolean,
): Array<{ offsetMins: number; durationMins: number }> {
  if (!enabled || intervalMins <= 0) return []
  const breaks: Array<{ offsetMins: number; durationMins: number }> = []
  for (let offset = intervalMins; offset < contentDurationMins; offset += intervalMins) {
    breaks.push({ offsetMins: offset, durationMins: 3 }) // 3-min ad pod
  }
  return breaks
}

// ─── Slot alignment: round UP to next hour or half-hour ──────────────────────

function alignEndTime(date: Date): Date {
  const mins = date.getMinutes()
  if (mins === 0)  return date
  if (mins <= 30)  return addMinutes(date, 30 - mins)
  return addMinutes(date, 60 - mins)
}

// ─── Core scheduler ──────────────────────────────────────────────────────────

/**
 * Generates schedules for all stations for the next `horizonDays` days.
 * Skips any station-day combination that already has a schedule row.
 * Requires an admin Plex token + server URL from the DB's first admin user.
 */
async function clearSchedulesForRange(params: { startDate: Date; endDate: Date; stationId?: string | null }): Promise<void> {
  const { startDate, endDate, stationId } = params
  const schedules = await prisma.schedule.findMany({
    where: {
      ...(stationId ? { stationId } : {}),
      date: {
        gte: startDate,
        lte: endDate,
      },
    },
    select: { id: true },
  })

  if (!schedules.length) return

  const scheduleIds = schedules.map((schedule) => schedule.id)
  const slots = await prisma.slot.findMany({
    where: { scheduleId: { in: scheduleIds } },
    select: { id: true },
  })
  const slotIds = slots.map((slot) => slot.id)

  await prisma.$transaction(async (tx) => {
    if (slotIds.length) {
      await tx.slotMediaItem.deleteMany({ where: { slotId: { in: slotIds } } })
      await tx.slot.deleteMany({ where: { id: { in: slotIds } } })
    }
    await tx.schedule.deleteMany({ where: { id: { in: scheduleIds } } })
  })
}

export async function runScheduler(
  horizonDays = 14,
  stationId?: string | null,
  options?: { forceRegenerate?: boolean },
): Promise<void> {
  if (schedulerIsRunning) {
    console.warn('[Scheduler] Run already in progress; skipping overlapping invocation.')
    return
  }

  schedulerIsRunning = true

  try {
  const forceRegenerate = Boolean(options?.forceRegenerate)
  console.log(`[Scheduler] Starting — horizon: ${horizonDays} days${stationId ? `, station: ${stationId}` : ''}${forceRegenerate ? ', force: true' : ''}`)

  // Fetch admin users and select one that actually has Plex credentials.
  const adminUsers = await prisma.user.findMany({
    where: { isAdmin: true },
    select: { id: true, preferences: true },
  })

  let plexToken = ''
  let plexServerUrl = ''
  for (const adminUser of adminUsers) {
    const prefs = fromJsonObject<Record<string, string>>(adminUser.preferences)
    if (prefs?.plexToken && prefs?.plexServerUrl) {
      plexToken = prefs.plexToken
      plexServerUrl = prefs.plexServerUrl
      break
    }
  }
  const stations = await prisma.station.findMany(
    stationId ? { where: { id: stationId } } : undefined,
  )
  if (stationId && !stations.length) {
    console.warn(`[Scheduler] Station ${stationId} not found — skipping run.`)
    return
  }
  const today = startOfDay(new Date())
  const finalDate = startOfDay(addDays(today, Math.max(0, horizonDays - 1)))

  if (forceRegenerate) {
    await clearSchedulesForRange({ startDate: today, endDate: finalDate, stationId })
  }

  const maxScheduled = await prisma.schedule.aggregate({
    where: { isActive: true },
    _max: { date: true },
  })
  const daysRemaining = maxScheduled._max.date
    ? differenceInCalendarDays(startOfDay(maxScheduled._max.date), today) + 1
    : 0
  if (forceRegenerate) {
    console.log('[Scheduler] Skipping Plex catalog sync during regeneration; using existing catalog.')
  } else {
    const forceCatalogSync = daysRemaining <= 3
    const catalogAutoSyncMaxAgeHours = await getCatalogAutoSyncMaxAgeHours()
    const catalogIsStale = await shouldSyncCatalog(catalogAutoSyncMaxAgeHours)

    if (forceCatalogSync || catalogIsStale) {
      if (!plexToken || !plexServerUrl) {
        console.warn('[Scheduler] Catalog is due for sync but Plex credentials are unavailable; continuing with existing synced catalog only.')
      } else {
        try {
          const summary = await syncPlexCatalog(new PlexClient(plexServerUrl, plexToken))
          console.log(
            `[Scheduler] Catalog sync complete (movies=${summary.movies}, shows=${summary.shows}, episodes=${summary.episodes}, upserts=${summary.upserts})`,
          )
        } catch (err) {
          console.error('[Scheduler] Catalog sync failed; continuing with existing synced catalog only:', err)
        }
      }
    } else {
      console.log(`[Scheduler] Catalog fresh enough; skipping auto-sync (threshold=${catalogAutoSyncMaxAgeHours}h).`)
    }
  }

  const holidayTagMap = await getHolidayTagMap()
  const holidaySettings = await loadHolidaySettings()
  const showOwnership = await buildShowOwnershipMap()
  const originalProfiles = await getOriginalStationProfiles()
  const overrideYears = new Set<number>()
  for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
    overrideYears.add(startOfDay(addDays(today, dayOffset)).getFullYear())
  }
  const holidayOverrideRows = await prisma.holidayOverride.findMany({
    where: {
      year: { in: Array.from(overrideYears) },
      OR: [
        { stationId: null },
        ...(stationId ? [{ stationId }] : []),
      ],
    },
  })

  for (const station of stations) {
    const blockedKeys = new Set(await getBlockedPlexKeys())
    const rawRules = fromJsonObject<Record<string, unknown>>(station.rules)
    const rules = normalizeStationRules(rawRules)
    const fillerPools      = fromJsonObject<Record<string, string | null>>(station.fillerPools)
    const holidayOverrides = fromJsonObject<Record<string, any>>(station.holidayOverrides)
    const profile = originalProfiles[station.id]

    for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
      const date = startOfDay(addDays(today, dayOffset))

      try {

      // Skip if already scheduled
      const existing = await prisma.schedule.findUnique({
        where: { stationId_date: { stationId: station.id, date } },
      })
      if (existing) continue

      const holiday       = getHolidayForDate(date, holidaySettings)
      const holidayConfig = holiday
        ? resolveHolidayConfig({
            holiday,
            date,
            stationId: station.id,
            rows: holidayOverrideRows,
            legacyOverrides: holidayOverrides,
          })
        : null
      const holidayContentOverride = Boolean(holidayConfig?.replace_schedule)
      const holidayTaggedKeys = holiday && holidayContentOverride ? new Set(holidayTagMap[holiday] ?? []) : null
      const isWeekend     = [0, 6].includes(getDay(date))
      const weekNumber    = Math.floor(dayOffset / 7) + 1

      // Create the schedule row
      const schedule = await prisma.schedule.create({
        data: { stationId: station.id, date, weekNumber, isActive: true },
      })

      // Pick the template — holiday full-replace, else weekday/weekend
      let blocks = isWeekend ? WEEKEND_BLOCKS : WEEKDAY_BLOCKS
      const stationBlocks = resolveStationTimeBlocks(date, rawRules, profile)

      // Genre overrides for holidays
      const effectiveAllowGenres = holidayContentOverride && holidayConfig?.content_priority?.length
        ? asStringArray(holidayConfig.content_priority)
        : rules.allow_genres

      const adEnabled  = holidayConfig?.ad_free ? false : rules.ad_policy.enabled
      const adIntervalTv    = rules.ad_policy.break_interval_tv
      const adIntervalMovie = rules.ad_policy.break_interval_movie

      // Pre-fetch available movies and shows from the synced catalog only.
      let availableMovies = await loadStationCandidates({
        type: 'movie',
        allowGenres: effectiveAllowGenres,
        denyGenres: rules.deny_genres,
        allowLanguages: rules.allow_languages,
        denyLanguages: rules.deny_languages,
      }).catch(() => [])

      let availableShows = await loadStationCandidates({
        type: 'show',
        allowGenres: effectiveAllowGenres,
        denyGenres: rules.deny_genres,
        allowLanguages: rules.allow_languages,
        denyLanguages: rules.deny_languages,
      }).catch(() => [])

      availableMovies = availableMovies.filter((movie) => !blockedKeys.has(movie.ratingKey))
      availableShows = availableShows
        .filter((show) => !blockedKeys.has(show.ratingKey))
        .filter((show) => showIsOwnedByStation(showOwnership, show.ratingKey, station.id))

      // Build the complete set of all holiday-tagged keys across all holidays.
      // Any item tagged for *any* holiday must only appear on its matching holiday day —
      // exclude them entirely from general scheduling when today's holiday doesn't match.
      const allHolidayTaggedKeys = new Set<string>(
        Object.values(holidayTagMap).flat()
      )
      // Keys that are valid for today's active holiday (if any)
      const todayPermittedHolidayKeys = holiday
        ? new Set<string>(holidayTagMap[holiday] ?? [])
        : new Set<string>()

      // Filter out holiday-tagged content that shouldn't air today:
      //   - If today has NO holiday: exclude all holiday-tagged items
      //   - If today HAS a holiday: keep only items tagged for today's holiday (or untagged items)
      availableMovies = availableMovies.filter((movie) => {
        if (!allHolidayTaggedKeys.has(movie.ratingKey)) return true  // untagged — always allowed
        return todayPermittedHolidayKeys.has(movie.ratingKey)         // tagged — only on matching holiday
      })
      availableShows = availableShows.filter((show) => {
        if (!allHolidayTaggedKeys.has(show.ratingKey)) return true
        return todayPermittedHolidayKeys.has(show.ratingKey)
      })

      // Rescue pool used only when normal placement fails repeatedly.
      const rescueMovies = (await getCatalogCandidates({
        type: 'movie',
        allowGenres: [],
        denyGenres: [],
        allowLanguages: [],
        denyLanguages: [],
      }).catch(() => [])).filter((movie) => !blockedKeys.has(movie.ratingKey))

      const holidayTaggedMovies = holidayTaggedKeys
        ? availableMovies.filter((movie) => holidayTaggedKeys.has(movie.ratingKey))
        : []
      const holidayTaggedShows = holidayTaggedKeys
        ? availableShows.filter((show) => holidayTaggedKeys.has(show.ratingKey))
        : []
      const dayTitleCounts = new Map<string, number>()
      const daySeriesCounts = new Map<string, number>()
      const dayEpisodeKeys = new Set<string>()

      // Build slots for the day
      let cursor = new Date(date)

      for (const block of blocks) {
        // Block window in absolute UTC
        const blockStart = new Date(date)
        blockStart.setHours(block.startHour, block.startMin, 0, 0)

        const blockEnd = new Date(date)
        blockEnd.setHours(
          block.endHour === 24 ? 0 : block.endHour,
          block.endMin,
          0,
          0,
        )
        // Handle midnight crossover
        if (block.endHour === 24 || blockEnd <= blockStart) {
          blockEnd.setDate(blockEnd.getDate() + 1)
        }

        const blockDurationMins = differenceInMinutes(blockEnd, blockStart)
        if (blockDurationMins <= 0) continue

        // Filter content by rating ceiling
        const validMovies = applyRatingCeiling(
          holidayTaggedMovies.length ? holidayTaggedMovies : availableMovies,
          block.ratingCeiling,
        ).filter(
          (m) => ratingAllowed(m.contentRating, block.ratingCeiling),
        )
        const validShows = applyRatingCeiling(
          holidayTaggedShows.length ? holidayTaggedShows : availableShows,
          block.ratingCeiling,
        ).filter(
          (s) => ratingAllowed(s.contentRating, block.ratingCeiling),
        )

        let slotStart = new Date(blockStart)
        let failedPlacementsAtCurrentStart = 0

        while (differenceInMinutes(blockEnd, slotStart) >= 30) {
          const remainingMins = differenceInMinutes(blockEnd, slotStart)
          const effectiveContentType = getContentTypeForSlot(slotStart, block.contentType, stationBlocks)

          if (failedPlacementsAtCurrentStart >= 6) {
            const fallbackDuration = Math.min(30, remainingMins)
            const fallbackAdBreaks = buildAdBreaks(fallbackDuration, adIntervalTv, adEnabled)

            const rescuePool = applyRatingCeiling(rescueMovies, block.ratingCeiling)
            const rescueCandidates = rescuePool.length ? rescuePool : rescueMovies
            const rescueMovie = pickMovieCandidate(
              rescueCandidates,
              block,
              fallbackDuration,
              dayTitleCounts,
            )

            if (rescueMovie) {
              const mediaItem = await upsertMediaItem(rescueMovie)
              const slot = await prisma.slot.create({
                data: {
                  scheduleId:    schedule.id,
                  startTime:     slotStart,
                  durationMins:  fallbackDuration,
                  contentSource: 'plex',
                  contentId:     rescueMovie.ratingKey,
                  adBreaks:      fallbackAdBreaks.length ? toJson(fallbackAdBreaks) : null,
                  fillerId:      null,
                  fillerDuration: null,
                  metadata:      toJson({ blockName: block.name, title: rescueMovie.title, reason: 'placement_safety_rescue' }),
                },
              })
              await prisma.slotMediaItem.create({
                data: { slotId: slot.id, mediaItemId: mediaItem.id, orderIndex: 0 },
              })
              await prisma.mediaItem.update({
                where: { id: mediaItem.id },
                data: { scheduledCount: { increment: 1 }, lastScheduled: new Date() },
              })

              incrementCount(dayTitleCounts, rescueMovie.title)
              slotStart = addMinutes(slotStart, fallbackDuration)
              failedPlacementsAtCurrentStart = 0
              continue
            }

            await prisma.slot.create({
              data: {
                scheduleId:    schedule.id,
                startTime:     slotStart,
                durationMins:  fallbackDuration,
                contentSource: 'youtube',
                adBreaks:      fallbackAdBreaks.length ? toJson(fallbackAdBreaks) : null,
                fillerId:      fillerPools.music ?? fillerPools.ads ?? null,
                fillerDuration: null,
                metadata:      toJson({ blockName: block.name, title: 'Filler', reason: 'placement_safety_fallback' }),
              },
            })
            slotStart = addMinutes(slotStart, fallbackDuration)
            failedPlacementsAtCurrentStart = 0
            continue
          }

          // ── FILLER block (infomercials, music videos) ──
          if (effectiveContentType === 'filler' || effectiveContentType === 'news') {
            const fillerDuration = remainingMins
            const fillerAdBreaks = buildAdBreaks(fillerDuration, adIntervalTv, adEnabled)
            await prisma.slot.create({
              data: {
                scheduleId:    schedule.id,
                startTime:     slotStart,
                durationMins:  fillerDuration,
                contentSource: 'youtube',
                adBreaks:      fillerAdBreaks.length ? toJson(fillerAdBreaks) : null,
                fillerId:      fillerPools.ads ?? fillerPools.music ?? null,
                fillerDuration: null,
                metadata:      toJson({ blockName: block.name, title: block.name }),
              },
            })
            slotStart = new Date(blockEnd)
            failedPlacementsAtCurrentStart = 0
            continue
          }

          // ── MOVIE block ──
          const tryMovieBlock = effectiveContentType === 'movie'
            || (effectiveContentType === 'mixed' && shouldTryMovieInMixedBlock({
              remainingMins,
              validMovies: validMovies.length,
              validShows: validShows.length,
              daySeriesCounts,
            }))

          if (tryMovieBlock && validMovies.length) {
            const chosen = pickMovieCandidate(validMovies, block, remainingMins, dayTitleCounts)
            if (!chosen) {
              failedPlacementsAtCurrentStart += 1
              continue
            }
            const adBreaks = buildAdBreaks(chosen.durationMins, adIntervalMovie, adEnabled)
            const slotEnd  = addMinutes(slotStart, chosen.durationMins)
            const alignedEnd = alignEndTime(slotEnd)
            const fillerMins = differenceInMinutes(alignedEnd, slotEnd)

            // Index the media item
            const mediaItem = await upsertMediaItem(chosen)

            const slot = await prisma.slot.create({
              data: {
                scheduleId:    schedule.id,
                startTime:     slotStart,
                durationMins:  chosen.durationMins,
                contentSource: 'plex',
                contentId:     chosen.ratingKey,
                adBreaks:      adBreaks.length ? toJson(adBreaks) : null,
                fillerId:      fillerMins > 0 ? (fillerPools.ads ?? fillerPools.music ?? null) : null,
                fillerDuration: fillerMins > 0 ? fillerMins : null,
                metadata:      toJson({ blockName: block.name, title: chosen.title, year: chosen.year }),
              },
            })
            await prisma.slotMediaItem.create({
              data: { slotId: slot.id, mediaItemId: mediaItem.id, orderIndex: 0 },
            })
            await prisma.mediaItem.update({
              where: { id: mediaItem.id },
              data: { scheduledCount: { increment: 1 }, lastScheduled: new Date() },
            })

            incrementCount(dayTitleCounts, chosen.title)

            slotStart = alignedEnd
            failedPlacementsAtCurrentStart = 0
            continue
          }

          // ── EPISODE block ──
          if (
            (effectiveContentType === 'episode' || effectiveContentType === 'mixed') &&
            validShows.length
          ) {
            // Check ShowProgress for a pinned show at this weekday + time
            const weekday = getDay(slotStart)
            const timeStr = `${String(slotStart.getHours()).padStart(2, '0')}:${String(slotStart.getMinutes()).padStart(2, '0')}`

            let progress = await prisma.showProgress.findFirst({
              where: {
                stationId:   station.id,
                airedWeekday: weekday,
                airedTime:   timeStr,
                isCompleted: false,
              },
            })

            if (progress && blockedKeys.has(progress.plexShowKey)) {
              progress = null
            }
            if (progress && !showIsOwnedByStation(showOwnership, progress.plexShowKey, station.id)) {
              progress = null
            }
            if (progress && holidayTaggedKeys?.size && !holidayTaggedKeys.has(progress.plexShowKey)) {
              progress = null
            }
            if (progress && (daySeriesCounts.get(progress.showTitle?.toLowerCase() || '') ?? 0) >= MAX_SERIES_EPISODES_PER_DAY) {
              progress = null
            }

            // If no pinned show, pick one from valid shows and create a progress record
            if (!progress) {
              const weightedShows = buildWeightedShowPool(validShows, block, daySeriesCounts)
              const remainingShows = [...weightedShows]

              while (remainingShows.length && !progress) {
                const show = weightedRandom(remainingShows)
                if (!show) break

                const seriesKey = show.title.toLowerCase()
                if ((daySeriesCounts.get(seriesKey) ?? 0) >= MAX_SERIES_EPISODES_PER_DAY) {
                  const idxSkipped = remainingShows.findIndex((entry) => entry.item.ratingKey === show.ratingKey)
                  if (idxSkipped >= 0) remainingShows.splice(idxSkipped, 1)
                  continue
                }

                if (!showIsOwnedByStation(showOwnership, show.ratingKey, station.id)) {
                  const idxOwner = remainingShows.findIndex((entry) => entry.item.ratingKey === show.ratingKey)
                  if (idxOwner >= 0) remainingShows.splice(idxOwner, 1)
                  continue
                }

                const idx = remainingShows.findIndex((entry) => entry.item.ratingKey === show.ratingKey)
                if (idx >= 0) remainingShows.splice(idx, 1)

                const epList = await getCatalogEpisodeList(show.ratingKey).catch(() => [])
                if (!epList.length) {
                  continue
                }

                progress = await prisma.showProgress.upsert({
                  where: {
                    stationId_plexShowKey: {
                      stationId: station.id,
                      plexShowKey: show.ratingKey,
                    },
                  },
                  update: {
                    airedWeekday: weekday,
                    airedTime: timeStr,
                    isCompleted: false,
                  },
                  create: {
                    stationId:     station.id,
                    plexShowKey:   show.ratingKey,
                    showTitle:     show.title,
                    episodeOrderJson: toJson(await buildEpisodeSnapshotList(show.ratingKey)),
                    nextSeason:    epList[0].season,
                    nextEpisode:   epList[0].episode,
                    totalSeasons:  Math.max(...epList.map((e) => e.season)),
                    totalEpisodes: epList.length,
                    airedWeekday:  weekday,
                    airedTime:     timeStr,
                  },
                })

                // First station to claim a show keeps ownership for exclusive channel identity.
                if (!showOwnership.has(show.ratingKey)) {
                  showOwnership.set(show.ratingKey, station.id)
                }
              }
            }

            if (progress) {
              const episodeOrder = await loadEpisodeSnapshot(progress)
              const episode = episodeOrder.find(
                (ref) => ref.season === progress.nextSeason && ref.episode === progress.nextEpisode,
              ) ?? null

              if (episode) {
                if (dayEpisodeKeys.has(episode.ratingKey)) {
                  // Avoid exact episode duplicates in the same station/day.
                  await prisma.showProgress.update({
                    where: { id: progress.id },
                    data: { isCompleted: true, lastAiredAt: new Date() },
                  }).catch(() => null)
                  failedPlacementsAtCurrentStart += 1
                  continue
                }

                const adBreaks   = buildAdBreaks(episode.durationMins, adIntervalTv, adEnabled)
                const slotEnd    = addMinutes(slotStart, episode.durationMins)
                const alignedEnd = alignEndTime(slotEnd)
                const fillerMins = differenceInMinutes(alignedEnd, slotEnd)

                const mediaItem = await upsertMediaItem(episode)
                const slot = await prisma.slot.create({
                  data: {
                    scheduleId:    schedule.id,
                    startTime:     slotStart,
                    durationMins:  episode.durationMins,
                    contentSource: 'plex',
                    contentId:     episode.ratingKey,
                    showTitle:     episode.showTitle ?? progress.showTitle,
                    seasonNumber:  episode.seasonNumber,
                    episodeNumber: episode.episodeNumber,
                    adBreaks:      adBreaks.length ? toJson(adBreaks) : null,
                    fillerId:      fillerMins > 0 ? (fillerPools.ads ?? fillerPools.music ?? null) : null,
                    fillerDuration: fillerMins > 0 ? fillerMins : null,
                    metadata:      toJson({
                          blockName: block.name,
                          showTitle: episode.showTitle ?? progress.showTitle,
                          season:    episode.seasonNumber,
                          episode:   episode.episodeNumber,
                        }),
                  },
                })
                await prisma.slotMediaItem.create({
                  data: { slotId: slot.id, mediaItemId: mediaItem.id, orderIndex: 0 },
                })

                await prisma.mediaItem.update({
                  where: { id: mediaItem.id },
                  data: { scheduledCount: { increment: 1 }, lastScheduled: new Date() },
                })
                await prisma.mediaItem.updateMany({
                  where: { plexKey: progress.plexShowKey },
                  data: { scheduledCount: { increment: 1 }, lastScheduled: new Date() },
                })

                // Advance the episode pointer
                await advanceShowProgress(progress)

                incrementCount(dayTitleCounts, episode.showTitle ?? episode.title)
                incrementCount(daySeriesCounts, episode.showTitle)
                dayEpisodeKeys.add(episode.ratingKey)

                slotStart = alignedEnd
                failedPlacementsAtCurrentStart = 0
                continue
              }

              // The pointer no longer maps to a valid catalog episode.
              // Mark complete so a new show can be selected in this same slot window.
              await prisma.showProgress.update({
                where: { id: progress.id },
                data: { isCompleted: true, lastAiredAt: new Date() },
              }).catch(() => null)
              failedPlacementsAtCurrentStart += 1
              continue
            }
          }

          // ── Fallback: YouTube filler ──
          const fallbackDuration = 30
          const fallbackAdBreaks = buildAdBreaks(fallbackDuration, adIntervalTv, adEnabled)

          const rescuePool = applyRatingCeiling(rescueMovies, block.ratingCeiling)
          const rescueCandidates = rescuePool.length ? rescuePool : rescueMovies
          const rescueMovie = pickMovieCandidate(
            rescueCandidates,
            block,
            fallbackDuration,
            dayTitleCounts,
          )

          if (rescueMovie) {
            const mediaItem = await upsertMediaItem(rescueMovie)
            const slot = await prisma.slot.create({
              data: {
                scheduleId:    schedule.id,
                startTime:     slotStart,
                durationMins:  fallbackDuration,
                contentSource: 'plex',
                contentId:     rescueMovie.ratingKey,
                adBreaks:      fallbackAdBreaks.length ? toJson(fallbackAdBreaks) : null,
                fillerId:      null,
                fillerDuration: null,
                metadata:      toJson({ blockName: block.name, title: rescueMovie.title, reason: 'fallback_rescue' }),
              },
            })
            await prisma.slotMediaItem.create({
              data: { slotId: slot.id, mediaItemId: mediaItem.id, orderIndex: 0 },
            })
            await prisma.mediaItem.update({
              where: { id: mediaItem.id },
              data: { scheduledCount: { increment: 1 }, lastScheduled: new Date() },
            })

            incrementCount(dayTitleCounts, rescueMovie.title)
            slotStart = addMinutes(slotStart, fallbackDuration)
            failedPlacementsAtCurrentStart = 0
            continue
          }

          await prisma.slot.create({
            data: {
              scheduleId:    schedule.id,
              startTime:     slotStart,
              durationMins:  fallbackDuration,
              contentSource: 'youtube',
              adBreaks:      fallbackAdBreaks.length ? toJson(fallbackAdBreaks) : null,
              fillerId:      fillerPools.music ?? fillerPools.ads ?? null,
              fillerDuration: null,
              metadata:      toJson({ blockName: block.name, title: 'Filler', reason: 'fallback_filler' }),
            },
          })
          slotStart = addMinutes(slotStart, 30)
          failedPlacementsAtCurrentStart = 0
        }
      }

      console.log(`[Scheduler] Scheduled ${station.id} for ${date.toISOString().split('T')[0]}`)
      } catch (err) {
        console.error(`[Scheduler] Failed ${station.id} for ${date.toISOString().split('T')[0]}:`, err)
      }
    }
  }

  console.log('[Scheduler] Run complete.')
  } finally {
    schedulerIsRunning = false
  }
}

// ─── Episode pointer advancement ─────────────────────────────────────────────

async function advanceShowProgress(
  progress: { id: string; nextSeason: number; nextEpisode: number; plexShowKey: string; totalEpisodes: number; episodeOrderJson?: string | null; lastAiredAt?: Date | null },
): Promise<void> {
  const now = new Date()
  if (!progress.lastAiredAt) {
    // First run pins episode 1 and starts the weekly progression timer.
    await prisma.showProgress.update({
      where: { id: progress.id },
      data: { lastAiredAt: now },
    })
    return
  }

  const msSinceLastAdvance = now.getTime() - progress.lastAiredAt.getTime()
  const minAdvanceMs = EPISODE_PROGRESS_INTERVAL_DAYS * 24 * 60 * 60 * 1000
  if (msSinceLastAdvance < minAdvanceMs) {
    // Hold on the same episode until the weekly cadence is reached.
    return
  }

  const storedSnapshot = parseEpisodeSnapshot(progress.episodeOrderJson)
  const epList = storedSnapshot.length ? storedSnapshot : await buildEpisodeSnapshotList(progress.plexShowKey)
  if (!epList.length) {
    await prisma.showProgress.update({
      where: { id: progress.id },
      data: { isCompleted: true, lastAiredAt: now },
    })
    return
  }

  const currentIdx = epList.findIndex(
    (e) => e.season === progress.nextSeason && e.episode === progress.nextEpisode,
  )

  if (currentIdx === -1) {
    const firstRef = epList[0]
    await prisma.showProgress.update({
      where: { id: progress.id },
      data: { nextSeason: firstRef.season, nextEpisode: firstRef.episode, lastAiredAt: now },
    })
    return
  }

  const nextRef = epList[currentIdx + 1]

  if (nextRef) {
    await prisma.showProgress.update({
      where: { id: progress.id },
      data: { nextSeason: nextRef.season, nextEpisode: nextRef.episode, lastAiredAt: now },
    })
  } else {
    // Series finished — mark complete
    await prisma.showProgress.update({
      where: { id: progress.id },
      data: { isCompleted: true, lastAiredAt: now },
    })
  }
}

// ─── MediaItem upsert ─────────────────────────────────────────────────────────

async function upsertMediaItem(item: {
  ratingKey: string
  title: string
  type: string
  year: number
  durationMins: number
  genres: string[]
  contentRating: string
  showPlexKey?: string
  showTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  chapters?: any[]
}) {
  return prisma.mediaItem.upsert({
    where: { plexKey: item.ratingKey },
    update: {},
    create: {
      plexKey:       item.ratingKey,
      title:         item.title,
      type:          item.type,
      year:          item.year,
      durationMins:  item.durationMins,
      genres:        item.genres.join(','),
      ratings:       item.contentRating,
      parentPlexKey: item.showPlexKey,
      showTitle:     item.showTitle,
      seasonNumber:  item.seasonNumber,
      episodeNumber: item.episodeNumber,
      chapters:      item.chapters ? toJson(item.chapters) : undefined,
    },
  })
}

// ─── Content weighting ───────────────────────────────────────────────────────
// Higher weight = more likely to be selected in weighted random pick.

function getRecencyWeight(lastScheduledAt?: Date | null): number {
  if (!lastScheduledAt) return 1.35

  const lastScheduledMs = lastScheduledAt.getTime()
  if (Number.isNaN(lastScheduledMs)) return 1

  const daysSinceScheduled = (Date.now() - lastScheduledMs) / (24 * 60 * 60 * 1000)

  if (daysSinceScheduled < 2) return 0.12
  if (daysSinceScheduled < 7) return 0.3
  if (daysSinceScheduled < 21) return 0.55
  if (daysSinceScheduled < 45) return 0.8
  if (daysSinceScheduled < 90) return 0.95
  return 1.1
}

function weightForItem(item: { year: number; genres: string[]; scheduledCount?: number; lastScheduledAt?: Date | null }, block: TimeBlock): number {
  let weight = 1.0

  // Prefer 1985–1997 era content
  if (item.year >= 1985 && item.year <= 1997) weight += 2.0
  else if (item.year >= 1975 && item.year < 1985) weight += 1.0
  else if (item.year > 1997) weight -= 0.5

  const scheduledCountPenalty = 1 / (1 + Math.max(0, (item.scheduledCount ?? 0) - 1) * 0.08)
  const recencyWeight = getRecencyWeight(item.lastScheduledAt)
  const hints = getGenreHintsForBlockName(block.name)
  const hasHintMatch = hints.length > 0 && hints.some((hint) => item.genres.includes(hint))
  const blockGenreAffinity = hints.length ? (hasHintMatch ? 1.4 : 0.78) : 1

  weight *= scheduledCountPenalty * recencyWeight * blockGenreAffinity

  return Math.max(weight, 0.1)
}

// ─── Auto-scheduler via setInterval ──────────────────────────────────────────
// Called from instrumentation.ts on server startup.
// Runs once immediately then every 6 hours.

let schedulerTimer: ReturnType<typeof setInterval> | null = null

export function startScheduler(): void {
  if (schedulerTimer) return // already running
  console.log('[Scheduler] Auto-scheduler started (runs every 6 hours).')

  const run = () => {
    runScheduler(14).catch((err) => {
      console.error('[Scheduler] Error during auto-run:', err)
    })
  }

  // First run after a short delay to let the server fully initialise
  setTimeout(run, 5_000)

  // Then every 6 hours
  schedulerTimer = setInterval(run, 6 * 60 * 60 * 1000)
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer)
    schedulerTimer = null
    console.log('[Scheduler] Auto-scheduler stopped.')
  }
}
