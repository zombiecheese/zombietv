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
import { syncPlexCatalog, shouldSyncCatalog, getCatalogAutoSyncMaxAgeHours, getCatalogCandidates, getCatalogEpisode, getCatalogEpisodeList, applyRatingCeiling, getBlockedPlexKeys, getHolidayTagMap, getActiveClassByPlexKey, getCatalogLibraryClassifications } from './plex-catalog'
import { getBroadcastTimezone, getSchedulerYearRange } from './app-settings'
import { toJson, fromJsonObject }        from './json'
import { parseClockToMinutes, getZonedParts, zonedTimeToUtc } from './time'
import { dateHintMatches, seasonalAffinityMultiplier, anniversaryYears } from './date-hints'
import { buildAdBreaks, buildContentAdBreaks, effectiveRuntimeMins, type BreakStrategy } from './scheduler/ad-breaks'
import { resolveWindowAlignedEnd, applySequenceRange } from './scheduler/alignment'
import { ratingAllowed, stricterRating, classificationCeiling } from './scheduler/ratings'
import { seedToUInt32, mulberry32, seededRandom01, weightedRandomWith } from './seeded-random'
import { itemMatchTokens } from './plex-catalog'
import { decryptSecret } from './secret-box'
import { differenceInMinutes, addMinutes } from 'date-fns'

// ─── Types ───────────────────────────────────────────────────────────────────

interface TimeBlock {
  name:          string
  startHour:     number
  startMin:      number
  endHour:       number
  endMin:        number
  // What kind of content belongs here
  contentType:   'movie' | 'episode' | 'mixed' | 'filler' | 'news'
  // Maximum content rating allowed in this block (daypart intent; the legal
  // Australian classification zone is applied on top of this per slot).
  ratingCeiling: 'G' | 'PG' | 'M' | 'MA15+'
  // Weeknight strip: the same series airs Monday–Friday in this window and
  // advances one episode per broadcast day (soaps, stripped cartoons).
  strip?:        boolean
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
  allowGenres?: string[]
  disabledLibraries?: string[]
  fillerWindows?: FillerWindow[]
  libraryWeights?: Record<string, number>
  openVideoId?: string
  closeVideoId?: string
  newsLiveVideoId?: string
  strip?: boolean
  // Where commercial breaks are placed for content in this window.
  breakStrategy?: BreakStrategy
  // Opt-in slot padding: content end is padded with filler to the next
  // increment boundary (0 = continuous back-to-back, no padding).
  scheduleIncrement?: number
  // Probabilistic marathon takeover of this window (FieldStation42-style).
  marathon?: { chance: number; count: number; hint?: string }
}

interface FillerWindow {
  durationMins: number
  category: string
  displayName?: string
  openVideo?: { enabled?: boolean; videoId?: string }
  closeVideo?: { enabled?: boolean; videoId?: string }
  // Optional pinned Plex show: the window plays this specific series and
  // advances its episode progression normally instead of YouTube filler.
  plexShowKey?: string
  plexShowTitle?: string
  fillMode?: 'fill' | 'single'   // fill the window with back-to-back episodes, or one episode then filler
  strip?: boolean                 // weeknight strip (daily Mon–Fri) vs weekly cadence
  // Sequence range: restrict this window to a fraction of the series
  // (0.0–1.0). The progression loops within the range when it runs out.
  sequenceStart?: number
  sequenceEnd?: number
}

interface ClosedownContent {
  type: 'graphic' | 'youtube_video' | 'youtube_playlist'
  value: string
}
interface SlotConfigSpec {
  key: string
  name: string
  start: string
  end: string
  enabled?: boolean
  fillerWindows?: FillerWindow[]
  disabledLibraries?: string[]
  libraryWeights?: { tv_shows?: number; movies?: number; animation?: number; fitness?: number }
  allowGenres?: string[]
  openVideo?: { enabled?: boolean; videoId?: string }
  closeVideo?: { enabled?: boolean; videoId?: string }
  newsVideo?: { enabled?: boolean; videoId?: string }
  strip?: boolean
  breakStrategy?: string          // 'standard' | 'center' | 'end'
  scheduleIncrement?: number      // 0 = continuous, else 5/10/15/20/30/60
  marathon?: { chance?: number; count?: number; hint?: string }
  preset?: string                 // named bundle in rules.slot_presets (preset values win)
}

function normalizeBreakStrategy(value: unknown): BreakStrategy | undefined {
  const s = String(value ?? '').trim().toLowerCase()
  if (s === 'standard' || s === 'center' || s === 'end') return s
  return undefined
}

function normalizeIncrement(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isFinite(n)) return undefined
  if (n <= 0) return 0
  const rounded = Math.round(n)
  return [5, 10, 15, 20, 30, 60].includes(rounded) ? rounded : 30
}

function normalizeMarathon(value: unknown): { chance: number; count: number; hint?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined
  const m = value as Record<string, unknown>
  const chance = Number(m.chance)
  const count = Number(m.count)
  if (!Number.isFinite(chance) || chance <= 0 || !Number.isFinite(count) || count < 1) return undefined
  const hint = String(m.hint ?? '').trim()
  return { chance: Math.min(1, chance), count: Math.min(12, Math.round(count)), hint: hint || undefined }
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
  markers?: Array<{ type: string; startMs: number; endMs: number }>
  airDate?: string   // YYYY-MM-DD original air date (enables broadcast-order + seasonal matching)
}

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

// Resolves the optional close-down loop content (graphic / YouTube video /
// playlist) configured on a station's rules. Returns null when unset/invalid.
function resolveClosedownContent(raw: Record<string, unknown>): ClosedownContent | null {
  const c = raw.closedown_content as Record<string, unknown> | undefined
  if (!c || typeof c !== 'object') return null
  const type = String(c.type ?? '')
  const value = String(c.value ?? '').trim()
  if (!value) return null
  if (type !== 'graphic' && type !== 'youtube_video' && type !== 'youtube_playlist') return null
  return { type, value }
}

// Picks the episode a newly scheduled show should start on. Skips Season 0
// (specials/extras), which sort before Season 1, so a show begins at its first
// real episode (typically S01E01) rather than a special. Falls back to the
// earliest episode when a show has no season >= 1.
function firstRegularEpisode<T extends { season: number; episode: number }>(list: T[]): T | null {
  if (!list.length) return null
  const regular = list.filter((e) => e.season >= 1)
  const pool = regular.length ? regular : list
  return pool.reduce((best, e) =>
    (e.season < best.season || (e.season === best.season && e.episode < best.episode)) ? e : best,
  )
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
      const chapters = Array.isArray(entry.chapters)
        ? (entry.chapters as Array<{ title: string; startOffsetMs: number }>)
        : undefined
      const markers = Array.isArray(entry.markers)
        ? (entry.markers as Array<{ type: string; startMs: number; endMs: number }>)
        : undefined
      const airDate = typeof entry.airDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(entry.airDate)
        ? entry.airDate.slice(0, 10)
        : undefined
      if (!Number.isFinite(season) || !Number.isFinite(episode) || !ratingKey || !title || !Number.isFinite(durationMins) || !Number.isFinite(year)) continue
      out.push({ season, episode, ratingKey, title, durationMins, contentRating, year, showTitle, type: 'episode', genres: [], seasonNumber: season, episodeNumber: episode, chapters, markers, airDate })
    }
    return sortEpisodeSnapshots(out)
  } catch {
    return []
  }
}

// Broadcast-order sort: when every episode carries an original air date, order
// by air date (fixes production-order vs air-order shows); otherwise fall back
// to season/episode numbering.
function sortEpisodeSnapshots(list: EpisodeSnapshotItem[]): EpisodeSnapshotItem[] {
  const allDated = list.length > 0 && list.every((e) => e.airDate)
  if (allDated) {
    return [...list].sort((a, b) =>
      a.airDate!.localeCompare(b.airDate!) || a.season - b.season || a.episode - b.episode,
    )
  }
  return [...list].sort((a, b) => a.season - b.season || a.episode - b.episode)
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
    seasonNumber: episode.seasonNumber ?? 0,
    episodeNumber: episode.episodeNumber ?? 0,
    showPlexKey: episode.showPlexKey,
    chapters: episode.chapters,
    markers: episode.markers,
    airDate: episode.originallyAvailableAt,
  }
}

async function buildEpisodeSnapshotList(
  showPlexKey: string,
  allowLanguages?: string[],
  denyLanguages?: string[],
  yearMin?: number | null,
  yearMax?: number | null,
): Promise<EpisodeSnapshotItem[]> {
  const refs = await getCatalogEpisodeList(showPlexKey, allowLanguages, denyLanguages, yearMin, yearMax).catch(() => [])
  const snapshots: EpisodeSnapshotItem[] = []

  for (const ref of refs) {
    const episode = await getCatalogEpisode(showPlexKey, ref.season, ref.episode, allowLanguages, denyLanguages, yearMin, yearMax).catch(() => null)
    if (episode) snapshots.push(snapshotEpisode(episode))
  }

  return sortEpisodeSnapshots(snapshots)
}

function normalizeDayName(day: string): string {
  return String(day).trim().toLowerCase()
}

function getBroadcastDayStart(date: Date, timezone: string): Date {
  const parts = getZonedParts(date, timezone)
  return zonedTimeToUtc(parts.year, parts.month - 1, parts.day, 0, 0, timezone)
}

function addBroadcastDays(date: Date, days: number, timezone: string): Date {
  const parts = getZonedParts(date, timezone)
  return zonedTimeToUtc(parts.year, parts.month - 1, parts.day + days, 0, 0, timezone)
}

function getBroadcastDayOfWeek(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
}

function getBroadcastMinutesOfDay(date: Date, timezone: string): number {
  const parts = getZonedParts(date, timezone)
  return parts.hour * 60 + parts.minute
}

function formatBroadcastTime(date: Date, timezone: string): string {
  const parts = getZonedParts(date, timezone)
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
}

function atBroadcastTime(date: Date, hour: number, minute: number, timezone: string): Date {
  const parts = getZonedParts(date, timezone)
  return zonedTimeToUtc(parts.year, parts.month - 1, parts.day, hour, minute, timezone)
}

function dayNameForDate(date: Date, timezone: string): string {
  return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][getBroadcastDayOfWeek(date, timezone)]
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
  timezone: string,
): EffectiveStationBlock[] {
  // Preferred: DB-backed weekday/weekend slot_config from the Station Rules editor.
  const slotConfig = (rawRules.slot_config ?? null) as { weekday?: SlotConfigSpec[]; weekend?: SlotConfigSpec[] } | null
  const slotPresets = (rawRules.slot_presets && typeof rawRules.slot_presets === 'object')
    ? (rawRules.slot_presets as Record<string, Partial<SlotConfigSpec>>)
    : {}
  if (slotConfig && (Array.isArray(slotConfig.weekday) || Array.isArray(slotConfig.weekend))) {
    const isWeekend = [0, 6].includes(getBroadcastDayOfWeek(stationDate, timezone))

    // Date-specific overrides (FieldStation42 date_overrides): a matching
    // calendar entry may swap the day template, replace specific windows, and
    // re-point every programming window's genre filter for that date.
    const parts = getZonedParts(stationDate, timezone)
    const weekdayNum = getBroadcastDayOfWeek(stationDate, timezone)
    const overrides = Array.isArray(rawRules.date_overrides)
      ? (rawRules.date_overrides as Array<Record<string, unknown>>)
      : []
    const matched = overrides.find((entry) => {
      const dates = String(entry?.dates ?? '').trim()
      if (!dates) return false
      return dateHintMatches(dates, { month: parts.month, day: parts.day, weekday: weekdayNum })
    }) ?? null

    let list = isWeekend ? slotConfig.weekend : slotConfig.weekday
    const dayTypeOverride = String(matched?.dayType ?? '').trim().toLowerCase()
    if (dayTypeOverride === 'weekday') list = slotConfig.weekday
    else if (dayTypeOverride === 'weekend') list = slotConfig.weekend

    let out = blocksFromSlotList(Array.isArray(list) ? list : [], slotPresets)

    if (matched) {
      const overrideSlots = Array.isArray(matched.slots) ? (matched.slots as SlotConfigSpec[]) : []
      if (overrideSlots.length) {
        const overrideBlocks = blocksFromSlotList(overrideSlots, slotPresets)
        if (overrideBlocks.length) {
          // Partial override: replacement windows win over any base window they
          // overlap; untouched hours keep the normal day template.
          out = [...overrideBlocks, ...out.filter((b) => !overrideBlocks.some((o) => stationWindowsOverlap(o, b)))]
        }
      }
      const overrideGenres = asStringArray(matched.allowGenres)
      if (overrideGenres.length) {
        out = out.map((b) => ({ ...b, allowGenres: overrideGenres }))
      }
    }
    if (out.length) return out
  }

  // Legacy fallback: inline time_blocks on the station rules.
  const inlineBlocks = Array.isArray(rawRules.time_blocks)
    ? (rawRules.time_blocks as StationTimeBlockSpec[])
    : []
  const source = inlineBlocks
  if (!source.length) return []

  const todayName = dayNameForDate(stationDate, timezone)
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

// Applies a named slot preset (reusable configuration bundle) to a slot.
// Preset values take precedence over the slot's own settings, except the
// identity/time fields which always come from the slot itself.
function applySlotPreset(
  slot: SlotConfigSpec,
  presets: Record<string, Partial<SlotConfigSpec>>,
): SlotConfigSpec {
  const presetName = String(slot?.preset ?? '').trim()
  if (!presetName) return slot
  const preset = presets[presetName]
  if (!preset || typeof preset !== 'object') return slot
  const { key: _key, name: _name, start: _start, end: _end, preset: _preset, enabled: _enabled, ...presetProps } = preset as Record<string, unknown>
  return { ...slot, ...presetProps } as SlotConfigSpec
}

// Maps a slot_config list to effective station blocks (shared between the
// normal day template and date-override slot lists).
function blocksFromSlotList(
  slots: SlotConfigSpec[],
  slotPresets: Record<string, Partial<SlotConfigSpec>>,
): EffectiveStationBlock[] {
  const out: EffectiveStationBlock[] = []
  for (const rawSlot of slots) {
    if (!rawSlot) continue
    const slot = applySlotPreset(rawSlot, slotPresets)
    if (slot?.enabled === false) continue
    const startMins = slot.start === 'first' ? 0 : (parseClockToMinutes(slot.start) ?? 0)
    const endMins = slot.end === 'until_finished' ? 24 * 60 : (parseClockToMinutes(slot.end) ?? 24 * 60)
    out.push({
      name: slot.name,
      day: '*',
      startMins,
      endMins,
      contentType: slotContentType(slot),
      allowGenres: Array.isArray(slot.allowGenres) && slot.allowGenres.length ? slot.allowGenres : undefined,
      disabledLibraries: Array.isArray(slot.disabledLibraries) && slot.disabledLibraries.length
        ? slot.disabledLibraries.map((key) => String(key).trim()).filter(Boolean)
        : undefined,
      fillerWindows: Array.isArray(slot.fillerWindows) ? slot.fillerWindows : undefined,
      libraryWeights: slot.libraryWeights as Record<string, number> | undefined,
      openVideoId: slot.openVideo?.enabled && slot.openVideo.videoId ? String(slot.openVideo.videoId).trim() : undefined,
      closeVideoId: slot.closeVideo?.enabled && slot.closeVideo.videoId ? String(slot.closeVideo.videoId).trim() : undefined,
      newsLiveVideoId: slot.newsVideo?.enabled && slot.newsVideo.videoId ? String(slot.newsVideo.videoId).trim() : undefined,
      strip: Boolean(slot.strip),
      breakStrategy: normalizeBreakStrategy(slot.breakStrategy),
      scheduleIncrement: normalizeIncrement(slot.scheduleIncrement),
      marathon: normalizeMarathon(slot.marathon),
    })
  }
  return out
}

// True when two station windows overlap in wall-clock time (handles windows
// that wrap past midnight by splitting them into linear spans).
function stationWindowsOverlap(
  a: { startMins: number; endMins: number },
  b: { startMins: number; endMins: number },
): boolean {
  const spans = (blk: { startMins: number; endMins: number }): Array<[number, number]> => {
    if (blk.startMins === blk.endMins) return [[0, 24 * 60]]
    if (blk.startMins < blk.endMins) return [[blk.startMins, blk.endMins]]
    return [[blk.startMins, 24 * 60], [0, blk.endMins]]
  }
  for (const [as, ae] of spans(a)) {
    for (const [bs, be] of spans(b)) {
      if (as < be && bs < ae) return true
    }
  }
  return false
}

function slotContentType(slot: SlotConfigSpec): TimeBlock['contentType'] {
  // If slot has filler windows but no library weights, it's filler-only
  const hasFillerWindows = Array.isArray(slot.fillerWindows) && slot.fillerWindows.length > 0
  const w = slot.libraryWeights ?? {}
  const hasLibraryWeights = Object.values(w).some(v => v && Number(v) > 0)
  
  if (hasFillerWindows && !hasLibraryWeights) return 'filler'
  
  const key = String(slot.key || '').toLowerCase()
  if (key.includes('news')) return 'news'
  const movies = Number(w.movies ?? 0)
  const episodic = Number(w.tv_shows ?? 0) + Number(w.animation ?? 0) + Number(w.fitness ?? 0)
  if (movies > 0 && movies >= episodic) return 'movie'
  if (episodic > 0) return 'episode'
  if (key.includes('movie')) return 'movie'
  return hasFillerWindows ? 'mixed' : 'mixed'
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
  timezone: string,
): TimeBlock['contentType'] {
  const normalizeType = (value: TimeBlock['contentType']): TimeBlock['contentType'] =>
    (value === 'filler' || value === 'news') ? 'mixed' : value

  if (!stationBlocks.length) return normalizeType(baseType)
  const mins = getBroadcastMinutesOfDay(slotStart, timezone)
  const matches = stationBlocks.filter((block) => timeIsInRange(mins, block.startMins, block.endMins))
  if (!matches.length) return normalizeType(baseType)

  // Narrower windows (e.g. Play School inside Children's Programming) win.
  const spanMins = (block: EffectiveStationBlock) => {
    if (block.startMins === block.endMins) return 24 * 60
    if (block.startMins < block.endMins) return block.endMins - block.startMins
    return 24 * 60 - block.startMins + block.endMins
  }

  matches.sort((a, b) => spanMins(a) - spanMins(b))
  const best = matches[0]
  // A filler-only slot must broadcast filler content, so let 'filler' pass through.
  if (best?.contentType === 'filler') return 'filler'
  return normalizeType(best?.contentType ?? baseType)
}

// Returns the narrowest station slot whose window contains the given time, or null.
function getMatchingStationBlock(
  slotStart: Date,
  stationBlocks: EffectiveStationBlock[],
  timezone: string,
): EffectiveStationBlock | null {
  if (!stationBlocks.length) return null
  const mins = getBroadcastMinutesOfDay(slotStart, timezone)
  const matches = stationBlocks.filter((block) => timeIsInRange(mins, block.startMins, block.endMins))
  if (!matches.length) return null
  const spanMins = (block: EffectiveStationBlock) => {
    if (block.startMins === block.endMins) return 24 * 60
    if (block.startMins < block.endMins) return block.endMins - block.startMins
    return 24 * 60 - block.startMins + block.endMins
  }
  matches.sort((a, b) => spanMins(a) - spanMins(b))
  return matches[0] ?? null
}

function normalizeDisabledLibraryToken(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return ''
  const collapsed = raw.replace(/[\s-]+/g, '_')
  if (collapsed === 'tv' || collapsed === 'tvshow' || collapsed === 'tvshows' || collapsed === 'shows') return 'tv_shows'
  if (collapsed === 'movie') return 'movies'
  if (collapsed === 'anime') return 'animation'
  if (collapsed === 'workout') return 'fitness'
  return collapsed
}

function resolveItemLibraryClass(
  item: PlexMediaItem,
  classByKey: Record<string, string>,
  classBySectionKey: Record<string, string>,
): string {
  const byKey = String(classByKey[item.ratingKey] ?? '').trim().toLowerCase()
  if (byKey) return byKey
  const sectionKey = String(item.sourceSectionKey ?? '').trim().toLowerCase()
  if (!sectionKey) return ''
  return String(classBySectionKey[sectionKey] ?? '').trim().toLowerCase()
}

// Apply a slot's per-slot allow-genres and library-weight exclusions to a candidate pool.
// Empty lists mean "any" (no filter). Falls back to the original pool when the
// filter would leave nothing, so a strict slot never starves the whole day.
// Allow tokens match genres, Plex collections, labels, countries and studio.
function filterCandidatesBySlot(
  items: PlexMediaItem[],
  block: EffectiveStationBlock | null,
  classByKey: Record<string, string>,
  classBySectionKey: Record<string, string>,
): PlexMediaItem[] {
  if (!block) return items
  const disabledLibraries = new Set(
    (block.disabledLibraries ?? [])
      .map((key) => normalizeDisabledLibraryToken(key))
      .filter(Boolean),
  )
  const afterLibraryExclusions = disabledLibraries.size
    ? items.filter((item) => {
      const sectionKey = String(item.sourceSectionKey ?? '').trim().toLowerCase()
      const libraryType = resolveItemLibraryClass(item, classByKey, classBySectionKey)
      if (sectionKey && disabledLibraries.has(sectionKey)) return false
      if (libraryType && disabledLibraries.has(libraryType)) return false
      return true
    })
    : items
  if (!afterLibraryExclusions.length) return []

  const allowGenres = (block.allowGenres ?? []).map((g) => g.toLowerCase()).filter(Boolean)
  const weights = block.libraryWeights
  const excludeZeroWeight = !!weights && Object.values(weights).some((w) => Number(w) > 0)
  if (!allowGenres.length && !excludeZeroWeight) return afterLibraryExclusions

  const filtered = afterLibraryExclusions.filter((item) => {
    if (allowGenres.length) {
      const tokens = itemMatchTokens(item)
      if (!allowGenres.some((g) => tokens.has(g))) return false
    }
    if (excludeZeroWeight) {
      const cls = resolveItemLibraryClass(item, classByKey, classBySectionKey)
      if (cls && Number((weights as Record<string, number>)[cls] ?? 1) <= 0) return false
    }
    return true
  })
  return filtered.length ? filtered : afterLibraryExclusions
}

// Multiplier applied to a candidate's selection weight based on the slot's
// per-library weights and the item's catalog library class.
function slotLibraryMultiplier(
  item: PlexMediaItem,
  weights: Record<string, number> | undefined,
  classByKey: Record<string, string>,
  classBySectionKey: Record<string, string>,
): number {
  if (!weights) return 1
  const cls = resolveItemLibraryClass(item, classByKey, classBySectionKey)
  if (!cls) return 1
  const w = Number(weights[cls] ?? 1)
  if (!Number.isFinite(w)) return 1
  return Math.max(0, w)
}

// ─── Plex-metadata quality multipliers ──────────────────────────────────
// (seasonal/anniversary date math lives in ./date-hints)

const DAY_MS = 24 * 60 * 60 * 1000
const PREMIERE_WINDOW_DAYS = 30
const RECENTLY_WATCHED_DAYS = 14

// Never-scheduled items recently added to the Plex library are premieres.
function isPremiereItem(item: PlexMediaItem): boolean {
  if ((item.scheduledCount ?? 0) > 0) return false
  if (!item.addedAtMs) return false
  return Date.now() - item.addedAtMs <= PREMIERE_WINDOW_DAYS * DAY_MS
}

// Combined metadata multiplier applied on top of library weights:
//  • seasonal/anniversary air-date affinity
//  • audience rating vs day part (prime time favours well-rated content,
//    late night tolerates the schlock)
//  • premiere boost for fresh, never-aired library additions
//  • penalty for content the household watched on Plex recently
function contentQualityMultiplier(
  item: PlexMediaItem,
  ctx: { month: number; day: number; minutesOfDay: number },
): number {
  let w = seasonalAffinityMultiplier(item.originallyAvailableAt, ctx.month, ctx.day)

  const score = item.audienceRating ?? item.criticRating
  if (score != null && Number.isFinite(score)) {
    const clamped = Math.max(0, Math.min(10, score))
    const inPrime = ctx.minutesOfDay >= 17 * 60 && ctx.minutesOfDay < 23 * 60
    const lateNight = ctx.minutesOfDay >= 23 * 60 || ctx.minutesOfDay < 5 * 60
    if (inPrime) w *= 0.55 + (clamped / 10) * 0.9         // 0.55 … 1.45
    else if (lateNight) w *= 1.15 - (clamped / 10) * 0.3  // 1.15 … 0.85
  }

  if (isPremiereItem(item)) w *= 1.8

  if (item.lastViewedAtMs && Date.now() - item.lastViewedAtMs <= RECENTLY_WATCHED_DAYS * DAY_MS) {
    w *= 0.3
  }

  return w
}

// Returns once-per-window bumper metadata (opening/closing short idents).
// Bumpers are never their own slot — they ride on the window's first program.
function bumperMetaForWindow(
  block: EffectiveStationBlock | null,
  assigned: Set<string>,
): Record<string, string> {
  if (!block) return {}
  const key = `${block.name}:${block.startMins}`
  if (assigned.has(key)) return {}
  const meta: Record<string, string> = {}
  if (block.openVideoId) meta.openBumperId = block.openVideoId
  if (block.closeVideoId) meta.closeBumperId = block.closeVideoId
  if (Object.keys(meta).length) assigned.add(key)
  return meta
}

// Per-window opening/closing idents configured on a filler window. These are
// stamped onto the window's own youtube filler slot so playback can play them
// strictly bounded to that window (opening at the start, closing at the end).
function fillerWindowBumpers(w: FillerWindow): { openBumperId?: string; closeBumperId?: string } {
  const out: { openBumperId?: string; closeBumperId?: string } = {}
  const o = w.openVideo?.enabled && w.openVideo.videoId ? String(w.openVideo.videoId).trim() : ''
  const c = w.closeVideo?.enabled && w.closeVideo.videoId ? String(w.closeVideo.videoId).trim() : ''
  if (o) out.openBumperId = o
  if (c) out.closeBumperId = c
  return out
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

async function loadEpisodeSnapshot(
  progress: { id: string; plexShowKey: string; episodeOrderJson: string | null },
  allowLanguages?: string[],
  denyLanguages?: string[],
  yearMin?: number | null,
  yearMax?: number | null,
): Promise<EpisodeSnapshotItem[]> {
  const existing = parseEpisodeSnapshot(progress.episodeOrderJson)
  if (existing.length) {
    // Guard against stale snapshots when language rules change over time.
    if (!(allowLanguages?.length || denyLanguages?.length || yearMin != null || yearMax != null)) return existing
    const allowedRefs = await getCatalogEpisodeList(progress.plexShowKey, allowLanguages, denyLanguages, yearMin, yearMax).catch(() => null)
    if (!allowedRefs) return existing
    const allowedKeys = new Set(allowedRefs.map((ref) => ref.ratingKey))
    const filtered = existing.filter((ref) => allowedKeys.has(ref.ratingKey))
    if (filtered.length === existing.length) return existing
    if (filtered.length) {
      await prisma.showProgress.update({
        where: { id: progress.id },
        data: { episodeOrderJson: toJson(filtered) },
      }).catch(() => null)
      return filtered
    }
  }

  const snapshot = await buildEpisodeSnapshotList(progress.plexShowKey, allowLanguages, denyLanguages, yearMin, yearMax)
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
  yearMin?: number | null
  yearMax?: number | null
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
    // Keep language filters even in fallback tier
  }).catch(() => [])
}

function resolveHolidayConfig(params: {
  holiday: string
  date: Date
  stationId: string
  rows: Array<{
    id: string
    holidayName: string
    stationId: string | null
    replaceSchedule: boolean
    adFree: boolean
    contentPriority: string
    onceOffEvent?: boolean
    consumedAt?: Date | string | null
  }>
  legacyOverrides: Record<string, any>
}): { config: ResolvedHolidayConfig | null; row: { id: string; onceOffEvent?: boolean } | null } {
  const { holiday, stationId, rows, legacyOverrides } = params

  const activeRows = rows.filter((row) => !row.consumedAt && row.holidayName === holiday)
  const stationSpecific = activeRows.find((row) => row.stationId === stationId)
  const globalOverride = activeRows.find((row) => row.stationId == null)
  const dbOverride = stationSpecific ?? globalOverride

  if (dbOverride) {
    return {
      config: {
        replace_schedule: dbOverride.replaceSchedule,
        ad_free: dbOverride.adFree,
        content_priority: asStringArray(dbOverride.contentPriority),
      },
      row: { id: dbOverride.id, onceOffEvent: Boolean(dbOverride.onceOffEvent) },
    }
  }

  const legacy = legacyOverrides[holiday]
  if (!legacy) return { config: null, row: null }

  return {
    config: {
    replace_schedule: Boolean(legacy.replace_schedule ?? true),
    ad_free: Boolean(legacy.ad_free ?? false),
    content_priority: asStringArray(legacy.content_priority),
    },
    row: null,
  }
}

// ─── 1990s Australian time-block templates ───────────────────────────────────
// These are the network-neutral defaults. A station's slot_config overrides the
// content type/genre/weights per window; the classification zone (see
// classificationCeiling) is always applied on top so nothing airs out of zone.

const WEEKDAY_BLOCKS: TimeBlock[] = [
  { name: 'Late Movies',         startHour:  0, startMin: 0,  endHour:  2, endMin: 0,  contentType: 'movie',   ratingCeiling: 'MA15+' },
  { name: 'Overnight Infomercials', startHour: 2, startMin: 0, endHour: 5, endMin: 0,  contentType: 'filler',  ratingCeiling: 'G'     },
  { name: 'Early Morning News',  startHour:  5, startMin: 0,  endHour:  6, endMin: 0,  contentType: 'news',    ratingCeiling: 'G'     },
  { name: 'Breakfast',           startHour:  6, startMin: 0,  endHour:  9, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'G'     },
  { name: 'Morning Lifestyle',   startHour:  9, startMin: 0,  endHour: 11, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Morning Reruns',      startHour: 11, startMin: 0,  endHour: 12, endMin: 0,  contentType: 'episode', ratingCeiling: 'PG'    },
  { name: 'Midday News',         startHour: 12, startMin: 0,  endHour: 12, endMin: 30, contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Midday Movie',        startHour: 12, startMin: 30, endHour: 14, endMin: 30, contentType: 'movie',   ratingCeiling: 'M'     },
  { name: 'Daytime Soaps',       startHour: 14, startMin: 30, endHour: 16, endMin: 0,  contentType: 'episode', ratingCeiling: 'PG', strip: true },
  { name: 'After-School TV',     startHour: 16, startMin: 0,  endHour: 17, endMin: 30, contentType: 'episode', ratingCeiling: 'G',  strip: true },
  { name: 'Early Evening',       startHour: 17, startMin: 30, endHour: 18, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Evening News',        startHour: 18, startMin: 0,  endHour: 18, endMin: 30, contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Current Affairs',     startHour: 18, startMin: 30, endHour: 19, endMin: 0,  contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Early Evening Soap',  startHour: 19, startMin: 0,  endHour: 19, endMin: 30, contentType: 'episode', ratingCeiling: 'PG', strip: true },
  { name: 'Prime Drama',         startHour: 19, startMin: 30, endHour: 20, endMin: 30, contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Movie / Drama',       startHour: 20, startMin: 30, endHour: 22, endMin: 30, contentType: 'mixed',   ratingCeiling: 'M'     },
  { name: 'Late News',           startHour: 22, startMin: 30, endHour: 23, endMin: 0,  contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Late Night',          startHour: 23, startMin: 0,  endHour: 24, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'MA15+' },
]

const SATURDAY_BLOCKS: TimeBlock[] = [
  { name: 'Late Movies',         startHour:  0, startMin: 0,  endHour:  2, endMin: 0,  contentType: 'movie',   ratingCeiling: 'MA15+' },
  { name: 'Overnight Infomercials', startHour: 2, startMin: 0, endHour: 6, endMin: 0,  contentType: 'filler',  ratingCeiling: 'G'     },
  { name: 'Saturday Cartoons',   startHour:  6, startMin: 0,  endHour: 10, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Morning Lifestyle',   startHour: 10, startMin: 0,  endHour: 12, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Weekend Sport',       startHour: 12, startMin: 0,  endHour: 17, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Family Programming',  startHour: 17, startMin: 0,  endHour: 18, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Weekend News',        startHour: 18, startMin: 0,  endHour: 18, endMin: 30, contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Saturday Night',      startHour: 18, startMin: 30, endHour: 20, endMin: 30, contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Saturday Movie',      startHour: 20, startMin: 30, endHour: 23, endMin: 0,  contentType: 'movie',   ratingCeiling: 'M'     },
  { name: 'Late Music Videos',   startHour: 23, startMin: 0,  endHour: 24, endMin: 0,  contentType: 'filler',  ratingCeiling: 'MA15+' },
]

const SUNDAY_BLOCKS: TimeBlock[] = [
  { name: 'Late Movies',         startHour:  0, startMin: 0,  endHour:  2, endMin: 0,  contentType: 'movie',   ratingCeiling: 'MA15+' },
  { name: 'Overnight Infomercials', startHour: 2, startMin: 0, endHour: 6, endMin: 0,  contentType: 'filler',  ratingCeiling: 'G'     },
  { name: 'Sunday Religion',     startHour:  6, startMin: 0,  endHour:  8, endMin: 0,  contentType: 'news',    ratingCeiling: 'G'     },
  { name: 'Sunday Morning',      startHour:  8, startMin: 0,  endHour: 10, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'G'     },
  { name: 'Family Programming',  startHour: 10, startMin: 0,  endHour: 12, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Weekend Sport',       startHour: 12, startMin: 0,  endHour: 17, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Family Programming',  startHour: 17, startMin: 0,  endHour: 18, endMin: 0,  contentType: 'episode', ratingCeiling: 'G'     },
  { name: 'Sunday News',         startHour: 18, startMin: 0,  endHour: 18, endMin: 30, contentType: 'news',    ratingCeiling: 'PG'    },
  { name: 'Sunday Night',        startHour: 18, startMin: 30, endHour: 20, endMin: 30, contentType: 'mixed',   ratingCeiling: 'PG'    },
  { name: 'Sunday Movie',        startHour: 20, startMin: 30, endHour: 23, endMin: 0,  contentType: 'movie',   ratingCeiling: 'M'     },
  { name: 'Late Night',          startHour: 23, startMin: 0,  endHour: 24, endMin: 0,  contentType: 'mixed',   ratingCeiling: 'MA15+' },
]

const SCHEDULER_RUN_STATUS_KEY = 'scheduler_run_status'
const CATALOG_STATE_STATION_ID = '__global__'

export interface SchedulerRunStatus {
  isRunning: boolean
  phase: 'idle' | 'starting' | 'loading_catalog' | 'scheduling' | 'finalizing' | 'complete' | 'error'
  horizonDays: number
  stationId: string | null
  forceRegenerate: boolean
  stationsTotal: number
  stationsProcessed: number
  daysTotal: number
  daysProcessed: number
  daysCreated: number
  startedAt: string | null
  updatedAt: string
  finishedAt: string | null
  lastError: string | null
  note: string | null
}

function buildSchedulerRunStatus(partial?: Partial<SchedulerRunStatus>): SchedulerRunStatus {
  return {
    isRunning: false,
    phase: 'idle',
    horizonDays: 7,
    stationId: null,
    forceRegenerate: false,
    stationsTotal: 0,
    stationsProcessed: 0,
    daysTotal: 0,
    daysProcessed: 0,
    daysCreated: 0,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    lastError: null,
    note: null,
    ...partial,
  }
}

async function saveSchedulerRunStatus(status: SchedulerRunStatus): Promise<void> {
  await prisma.adminPreference.upsert({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: SCHEDULER_RUN_STATUS_KEY,
      },
    },
    update: { settingValue: toJson(status) },
    create: {
      stationId: CATALOG_STATE_STATION_ID,
      settingKey: SCHEDULER_RUN_STATUS_KEY,
      settingValue: toJson(status),
    },
  })
}

export async function getSchedulerRunStatus(): Promise<SchedulerRunStatus> {
  const row = await prisma.adminPreference.findUnique({
    where: {
      stationId_settingKey: {
        stationId: CATALOG_STATE_STATION_ID,
        settingKey: SCHEDULER_RUN_STATUS_KEY,
      },
    },
    select: { settingValue: true },
  })

  if (!row?.settingValue) return buildSchedulerRunStatus()
  try {
    return buildSchedulerRunStatus(JSON.parse(row.settingValue) as Partial<SchedulerRunStatus>)
  } catch {
    return buildSchedulerRunStatus()
  }
}

let schedulerIsRunning = false
const MAX_SERIES_EPISODES_PER_DAY = 2
const EPISODE_PROGRESS_INTERVAL_DAYS = 7
const MAX_CONTENT_OVERRUN_MINS = 10
// Sentinel weekday for weeknight strips: one series owns this slot across all of
// Monday–Friday (stored instead of a single 0–6 weekday) and advances daily.
const STRIP_WEEKDAY = 7

export function isSchedulerRunning(): boolean {
  return schedulerIsRunning
}

// ─── Random selection utilities ──────────────────────────────────────────────
// (ratingAllowed / classification zones live in ./scheduler/ratings)

// Fisher-Yates shuffle: in-place randomization of array order.
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function weightedRandom<T>(items: Array<{ item: T; weight: number }>): T | null {
  return weightedRandomWith(items)
}

function incrementCount(map: Map<string, number>, key: string | null | undefined): void {
  if (!key) return
  const normalized = key.trim().toLowerCase()
  if (!normalized) return
  map.set(normalized, (map.get(normalized) ?? 0) + 1)
}

// ─── Cross-station airing coordination ───────────────────────────────────────
// Tracks which catalog items are already on air (by ratingKey) across all
// stations for the whole run, so two channels don't broadcast the same title in
// an overlapping window.

type Airing = { start: number; end: number }

function recordAiring(map: Map<string, Airing[]>, key: string, start: number, end: number): void {
  if (!key) return
  const list = map.get(key) ?? []
  list.push({ start, end })
  map.set(key, list)
}

// Returns the set of ratingKeys already on air at the given instant on any station.
function keysAiringAt(map: Map<string, Airing[]>, atMs: number): Set<string> {
  const out = new Set<string>()
  for (const [key, intervals] of map) {
    if (intervals.some((r) => atMs >= r.start && atMs < r.end)) out.add(key)
  }
  return out
}

function pickMovieCandidate(
  movies: PlexMediaItem[],
  block: TimeBlock,
  remainingMins: number,
  adIntervalMovie: number,
  adEnabled: boolean,
  dayTitleCounts: Map<string, number>,
  libMultiplier: (item: PlexMediaItem) => number = () => 1,
  options?: { excludeKeys?: Set<string>; maxOverrunMins?: number },
): PlexMediaItem | null {
  const excludeKeys = options?.excludeKeys
  const maxOverrunMins = options?.maxOverrunMins ?? MAX_CONTENT_OVERRUN_MINS

  // Tight runtime fit: content plus ad breaks can overrun a little, but not much.
  const eligible = movies.filter((movie) => {
    if (excludeKeys?.has(movie.ratingKey)) return false
    const adBreaks = buildAdBreaks(movie.durationMins, adIntervalMovie, adEnabled)
    const adMins = adBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
    if (movie.durationMins + adMins > remainingMins + maxOverrunMins) return false
    return true
  })
  if (!eligible.length) return null

  const tolerances = [15, 30, 45, 60]
  const pool = tolerances
    .map((tolerance) => eligible.filter((movie) => {
      const adBreaks = buildAdBreaks(movie.durationMins, adIntervalMovie, adEnabled)
      const adMins = adBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
      return Math.abs(movie.durationMins + adMins - remainingMins) <= tolerance
    }))
    .find((candidates) => candidates.length)
    ?? eligible

  return weightedRandom(
    pool.map((movie) => {
      const adBreaks = buildAdBreaks(movie.durationMins, adIntervalMovie, adEnabled)
      const adMins = adBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
      const diff = Math.abs(movie.durationMins + adMins - remainingMins)
      const repeatPenalty = 1 / (1 + (dayTitleCounts.get(movie.title.toLowerCase()) ?? 0) * 2.5)
      const fitBonus = Math.max(0.2, 2 - diff / 45)

      return {
        item: movie,
        weight: Math.max(0.05, weightForItem(movie, block) * repeatPenalty * fitBonus * libMultiplier(movie)),
      }
    }),
  )
}

function buildWeightedShowPool(
  shows: PlexMediaItem[],
  block: TimeBlock,
  daySeriesCounts: Map<string, number>,
  libMultiplier: (item: PlexMediaItem) => number = () => 1,
) {
  return shows.map((show) => {
    const seriesKey = show.title.toLowerCase()
    const repeatPenalty = 1 / (1 + (daySeriesCounts.get(seriesKey) ?? 0) * 3)

    return {
      item: show,
      weight: Math.max(0.05, weightForItem(show, block) * repeatPenalty * libMultiplier(show)),
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

// Ad break construction, slot alignment and sequence ranges are pure functions
// extracted to ./scheduler/ad-breaks and ./scheduler/alignment so they can be
// unit-tested in isolation.

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
  horizonDays = 7,
  stationId?: string | null,
  options?: { forceRegenerate?: boolean },
): Promise<void> {
  if (schedulerIsRunning) {
    console.warn('[Scheduler] Run already in progress; skipping overlapping invocation.')
    return
  }

  schedulerIsRunning = true

  const forceRegenerate = Boolean(options?.forceRegenerate)
  const runStatus = buildSchedulerRunStatus({
    isRunning: true,
    phase: 'starting',
    horizonDays,
    stationId: stationId ?? null,
    forceRegenerate,
    stationsTotal: 0,
    stationsProcessed: 0,
    daysTotal: 0,
    daysProcessed: 0,
    daysCreated: 0,
    startedAt: new Date().toISOString(),
    note: forceRegenerate ? 'Starting regeneration run' : 'Starting schedule generation run',
  })
  const persistStatus = async (partial: Partial<SchedulerRunStatus>) => {
    Object.assign(runStatus, partial, {
      updatedAt: new Date().toISOString(),
    })
    await saveSchedulerRunStatus(runStatus)
  }

  try {
    console.log(`[Scheduler] Starting — horizon: ${horizonDays} days${stationId ? `, station: ${stationId}` : ''}${forceRegenerate ? ', force: true' : ''}`)

    const adminUsers = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { id: true, preferences: true },
    })

    let plexToken = ''
    let plexServerUrl = ''
    for (const adminUser of adminUsers) {
      const prefs = fromJsonObject<Record<string, string>>(adminUser.preferences)
      if (prefs?.plexToken && prefs?.plexServerUrl) {
        plexToken = decryptSecret(prefs.plexToken)
        plexServerUrl = prefs.plexServerUrl
        break
      }
    }

    const stations = await prisma.station.findMany(
      stationId ? { where: { id: stationId } } : undefined,
    )
    if (stationId && !stations.length) {
      console.warn(`[Scheduler] Station ${stationId} not found — skipping run.`)
      await persistStatus({
        isRunning: false,
        phase: 'error',
        finishedAt: new Date().toISOString(),
        lastError: `Station ${stationId} was not found.`,
        note: 'Station scope not found',
      })
      return
    }

    const broadcastTimezone = await getBroadcastTimezone()
    const today = getBroadcastDayStart(new Date(), broadcastTimezone)
    const schedulerYearRange = await getSchedulerYearRange()
    await persistStatus({
      phase: 'loading_catalog',
      stationsTotal: stations.length,
      daysTotal: Math.max(1, horizonDays * Math.max(1, stations.length)),
      note: stationId
        ? `Preparing ${horizonDays}-day regeneration for ${stationId}`
        : `Preparing ${horizonDays}-day generation for ${stations.length} stations`,
    })
    const finalDate = addBroadcastDays(today, Math.max(0, horizonDays - 1), broadcastTimezone)

    if (forceRegenerate) {
      await clearSchedulesForRange({ startDate: today, endDate: finalDate, stationId })
    }

    const maxScheduled = await prisma.schedule.aggregate({
      where: { isActive: true },
      _max: { date: true },
    })
    const daysRemaining = maxScheduled._max.date
      ? Math.floor((getBroadcastDayStart(maxScheduled._max.date, broadcastTimezone).getTime() - today.getTime()) / 86_400_000) + 1
      : 0
    await persistStatus({
      phase: 'loading_catalog',
      note: forceRegenerate
        ? 'Skipping catalog sync during regeneration and reusing the existing catalog snapshot'
        : 'Checking catalog freshness before scheduling',
    })
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
    const activeClassByPlexKey = await getActiveClassByPlexKey()
    const catalogClassifications = await getCatalogLibraryClassifications()
    const activeClassBySectionKey: Record<string, string> = {}
    for (const [sectionKey, className] of Object.entries(catalogClassifications)) {
      const normalizedSectionKey = String(sectionKey).trim().toLowerCase()
      if (!normalizedSectionKey) continue
      activeClassBySectionKey[normalizedSectionKey] = String(className ?? '').trim().toLowerCase()
    }

    // Cross-station airing ledger for the whole run. Stations are processed
    // sequentially, so each station can see what earlier stations already placed
    // and avoid broadcasting the same title at the same time on another channel.
    const globalAirings = new Map<string, Airing[]>()

    // Cross-station ad-break deconfliction. Every scheduled ad pod start-time is
    // claimed (UTC ms). New slots shift each break forward by whole minutes until
    // they land on a free minute so channels do not cut to ads simultaneously.
    const globalAdBreakStartMs = new Set<number>()
    const deconflictAdBreaksForSlot = (
      slotStart: Date,
      contentDurationMins: number,
      adBreaks: Array<{ offsetMins: number; durationMins: number }>,
    ): Array<{ offsetMins: number; durationMins: number }> => {
      if (!adBreaks.length || contentDurationMins <= 1) return []

      const out: Array<{ offsetMins: number; durationMins: number }> = []
      const claimedOffsets = new Set<number>()
      const slotStartMs = slotStart.getTime()

      for (const ad of adBreaks) {
        let offsetMins = Math.max(1, Math.min(contentDurationMins - 1, Math.round(ad.offsetMins)))

        while (
          offsetMins < contentDurationMins &&
          (claimedOffsets.has(offsetMins) || globalAdBreakStartMs.has(slotStartMs + offsetMins * 60_000))
        ) {
          offsetMins += 1
        }

        if (offsetMins >= contentDurationMins) continue

        claimedOffsets.add(offsetMins)
        globalAdBreakStartMs.add(slotStartMs + offsetMins * 60_000)
        out.push({ offsetMins, durationMins: ad.durationMins })
      }

      return out
    }

    // Cross-station movie exclusivity over a rolling one-week window. A movie may
    // air on at most one channel within any 7-day span, so every movie placed by
    // any station is recorded against its broadcast day and excluded from every
    // channel whose day falls within a week of that airing. Seeded from
    // already-persisted movie slots (including the prior week) so the rule also
    // holds across partial (single-station) regenerations and against schedules
    // that already aired.
    const MOVIE_EXCLUSIVITY_MS = 7 * 24 * 60 * 60 * 1000
    const movieClaimDays = new Map<string, number[]>()
    const recordMovieClaim = (date: Date, ratingKey: string): void => {
      if (!ratingKey) return
      const dayMs = getBroadcastDayStart(date, broadcastTimezone).getTime()
      const list = movieClaimDays.get(ratingKey) ?? []
      list.push(dayMs)
      movieClaimDays.set(ratingKey, list)
    }
    const moviesBlockedForDay = (date: Date): Set<string> => {
      const dayMs = getBroadcastDayStart(date, broadcastTimezone).getTime()
      const blocked = new Set<string>()
      for (const [ratingKey, days] of movieClaimDays) {
        if (days.some((d) => Math.abs(d - dayMs) < MOVIE_EXCLUSIVITY_MS)) blocked.add(ratingKey)
      }
      return blocked
    }
    {
      const seedDates: Date[] = []
      for (let dayOffset = -7; dayOffset < horizonDays; dayOffset++) {
        seedDates.push(addBroadcastDays(today, dayOffset, broadcastTimezone))
      }
      const existingMovieSlots = await prisma.slot.findMany({
        where: {
          contentSource: 'plex',
          seasonNumber: null,
          contentId: { not: null },
          schedule: { date: { in: seedDates } },
        },
        select: { contentId: true, schedule: { select: { date: true } } },
      }).catch(() => [] as Array<{ contentId: string | null; schedule: { date: Date } }>)
      for (const row of existingMovieSlots) {
        if (row.contentId) recordMovieClaim(row.schedule.date, row.contentId)
      }
    }

    const overrideYears = new Set<number>()
    for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
      const parts = getZonedParts(addBroadcastDays(today, dayOffset, broadcastTimezone), broadcastTimezone)
      overrideYears.add(parts.year)
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

    await persistStatus({
      phase: 'scheduling',
      note: 'Generating station schedules',
    })

    for (const station of stations) {
      const blockedKeys = new Set(await getBlockedPlexKeys())
      const rawRules = fromJsonObject<Record<string, unknown>>(station.rules)

      // Non-standard channel types (weather / guide / loop / stream / web)
      // derive their playback state directly from rules — no schedule rows.
      const channelType = String(rawRules.channel_type ?? 'standard').trim().toLowerCase()
      if (channelType && channelType !== 'standard') {
        console.log(`[Scheduler] Skipping ${station.id} — '${channelType}' channels do not use schedules.`)
        await persistStatus({
          stationsProcessed: runStatus.stationsProcessed + 1,
          daysProcessed: runStatus.daysProcessed + horizonDays,
          note: `Skipped ${station.id} (${channelType} channel)`,
        })
        continue
      }

      const rules = normalizeStationRules(rawRules)
      // Station-wide showtime offset: shifts alignment boundaries so shows can
      // start at e.g. :05/:35 instead of :00/:30 (FieldStation42 schedule_offset).
      const scheduleOffsetMins = (() => {
        const n = Number(rawRules.schedule_offset ?? 0)
        return Number.isFinite(n) ? Math.max(0, Math.min(29, Math.round(n))) : 0
      })()
      const overnightClosedown = Boolean(rawRules.overnight_closedown)
      const fillerPools      = fromJsonObject<Record<string, string | null>>(station.fillerPools)
      const holidayOverrides = fromJsonObject<Record<string, any>>(station.holidayOverrides)
      for (let dayOffset = 0; dayOffset < horizonDays; dayOffset++) {
        const date = addBroadcastDays(today, dayOffset, broadcastTimezone)

        try {

          // Skip if already scheduled
          const existing = await prisma.schedule.findUnique({
            where: { stationId_date: { stationId: station.id, date } },
          })
          if (existing) {
            await persistStatus({
              daysProcessed: runStatus.daysProcessed + 1,
              note: `Skipped existing schedule for ${station.id} on ${date.toISOString().split('T')[0]}`,
            })
            continue
          }

          const holiday       = getHolidayForDate(date, holidaySettings)
          const holidayResolved = holiday
            ? resolveHolidayConfig({
                holiday,
                date,
                stationId: station.id,
                rows: holidayOverrideRows,
                legacyOverrides: holidayOverrides,
              })
            : { config: null, row: null }
          const holidayConfig = holidayResolved.config
          const holidayContentOverride = Boolean(holidayConfig?.replace_schedule)
          const holidayTaggedKeys = holiday && holidayContentOverride ? new Set(holidayTagMap[holiday] ?? []) : null
          const weekNumber    = Math.floor(dayOffset / 7) + 1

          // Create the schedule row
          const schedule = await prisma.schedule.create({
            data: { stationId: station.id, date, weekNumber, isActive: true },
          })

          if (holidayResolved.row?.onceOffEvent && holidayContentOverride) {
            await prisma.holidayOverride.update({
              where: { id: holidayResolved.row.id },
              data: { consumedAt: new Date() },
            }).catch(() => null)
          }

          // Pick the template — holiday full-replace, else weekday/weekend
          const broadcastWeekday = getBroadcastDayOfWeek(date, broadcastTimezone)
          const blocks = broadcastWeekday === 6 ? SATURDAY_BLOCKS : broadcastWeekday === 0 ? SUNDAY_BLOCKS : WEEKDAY_BLOCKS
          const stationBlocks = resolveStationTimeBlocks(date, rawRules, broadcastTimezone)

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
            yearMin: schedulerYearRange.minYear,
            yearMax: schedulerYearRange.maxYear,
          }).catch(() => [])

          let availableShows = await loadStationCandidates({
            type: 'show',
            allowGenres: effectiveAllowGenres,
            denyGenres: rules.deny_genres,
            allowLanguages: rules.allow_languages,
            denyLanguages: rules.deny_languages,
            yearMin: schedulerYearRange.minYear,
            yearMax: schedulerYearRange.maxYear,
          }).catch(() => [])

          availableMovies = availableMovies.filter((movie) => !blockedKeys.has(movie.ratingKey))
          availableShows = availableShows
            .filter((show) => !blockedKeys.has(show.ratingKey))
            .filter((show) => showIsOwnedByStation(showOwnership, show.ratingKey, station.id))

          const allHolidayTaggedKeys = new Set<string>(
            Object.values(holidayTagMap).flat(),
          )
          const todayPermittedHolidayKeys = holiday
            ? new Set<string>(holidayTagMap[holiday] ?? [])
            : new Set<string>()

          availableMovies = availableMovies.filter((movie) => {
            if (!allHolidayTaggedKeys.has(movie.ratingKey)) return true
            return todayPermittedHolidayKeys.has(movie.ratingKey)
          })
          availableShows = availableShows.filter((show) => {
            if (!allHolidayTaggedKeys.has(show.ratingKey)) return true
            return todayPermittedHolidayKeys.has(show.ratingKey)
          })

          // Randomize pools to avoid deterministic ordering from catalog
          shuffle(availableMovies)
          shuffle(availableShows)

          const rescueMovies = (await getCatalogCandidates({
            type: 'movie',
            allowGenres: [],
            denyGenres: [],
            allowLanguages: [],
            denyLanguages: [],
            yearMin: schedulerYearRange.minYear,
            yearMax: schedulerYearRange.maxYear,
          }).catch(() => [])).filter((movie) => !blockedKeys.has(movie.ratingKey))
          shuffle(rescueMovies)

          const holidayTaggedMovies = holidayTaggedKeys
            ? availableMovies.filter((movie) => holidayTaggedKeys.has(movie.ratingKey))
            : []
          const holidayTaggedShows = holidayTaggedKeys
            ? availableShows.filter((show) => holidayTaggedKeys.has(show.ratingKey))
            : []
          const dayTitleCounts = new Map<string, number>()
          const daySeriesCounts = new Map<string, number>()
          // Broadcast-zone month/day for this generation day — drives seasonal
          // affinity, anniversary detection and premiere stamping.
          const dayCalendarParts = getZonedParts(date, broadcastTimezone)
          // Every exact catalog item (movie or episode) placed today on this
          // station. Guarantees no exact repeat within a single day.
          const dayUsedMediaKeys = new Set<string>()
          // Movies claimed by any channel within a week of this day (rolling
          // 7-day exclusivity). Computed once per day; same-day/same-station
          // repeats are additionally covered by dayUsedMediaKeys.
          const weekBlockedMovies = moviesBlockedForDay(date)
          const windowBumperAssigned = new Set<string>()

          // Deferred usage counters — flushed once per station-day in grouped
          // updateMany calls instead of one row-level update per placement.
          const dayMediaItemUses = new Map<string, number>()
          const dayParentShowUses = new Map<string, number>()
          const recordMediaUse = (mediaItemId: string) => dayMediaItemUses.set(mediaItemId, (dayMediaItemUses.get(mediaItemId) ?? 0) + 1)
          const recordParentShowUse = (plexShowKey: string) => dayParentShowUses.set(plexShowKey, (dayParentShowUses.get(plexShowKey) ?? 0) + 1)
          const flushUsageCounts = async () => {
            const flushedAt = new Date()
            const groupByCount = (entries: Map<string, number>) => {
              const groups = new Map<number, string[]>()
              for (const [key, count] of entries) {
                const list = groups.get(count) ?? []
                list.push(key)
                groups.set(count, list)
              }
              return groups
            }
            for (const [count, ids] of groupByCount(dayMediaItemUses)) {
              await prisma.mediaItem.updateMany({
                where: { id: { in: ids } },
                data: { scheduledCount: { increment: count }, lastScheduled: flushedAt },
              }).catch(() => null)
            }
            for (const [count, keys] of groupByCount(dayParentShowUses)) {
              await prisma.mediaItem.updateMany({
                where: { plexKey: { in: keys } },
                data: { scheduledCount: { increment: count }, lastScheduled: flushedAt },
              }).catch(() => null)
            }
          }

          const reservedIntervals: Array<{ start: number; end: number }> = []
          const dayStartMs = getBroadcastDayStart(date, broadcastTimezone).getTime()
          const dayEndMs = addBroadcastDays(date, 1, broadcastTimezone).getTime()
          const dayEvents = await prisma.specialEvent.findMany({
            where: {
              consumedAt: null,
              OR: [{ stationId: null }, { stationId: station.id }],
            },
          })
          const eventPriorityRank = (p: string) => (p === 'high' ? 0 : p === 'medium' ? 1 : 2)
          dayEvents.sort((a, b) =>
            eventPriorityRank(a.priority) - eventPriorityRank(b.priority)
            || a.startTime.getTime() - b.startTime.getTime(),
          )

          for (const ev of dayEvents) {
            let evContent: { source?: string; id?: string; untilContentFinished?: boolean } = {}
            try { evContent = JSON.parse(ev.content) } catch { evContent = {} }
            const evSource = String(evContent.source ?? '').toLowerCase()
            const evContentId = String(evContent.id ?? '').trim()
            if (!evContentId) continue

            const eventParts = getZonedParts(ev.startTime, broadcastTimezone)
            const currentParts = getZonedParts(date, broadcastTimezone)
            const eventMonthDay = eventParts.month * 100 + eventParts.day
            const currentMonthDay = currentParts.month * 100 + currentParts.day
            if (eventMonthDay !== currentMonthDay) continue

            const startMs = atBroadcastTime(date, eventParts.hour, eventParts.minute, broadcastTimezone)
            const startTimeMs = startMs.getTime()
            if (startTimeMs < dayStartMs || startTimeMs >= dayEndMs) continue

            let durationMins = ev.durationMins > 0 ? ev.durationMins : 0
            let eventMediaItemId: string | null = null
            if (evSource === 'plex') {
              const mi = await prisma.mediaItem
                .findUnique({ where: { plexKey: evContentId }, select: { id: true, durationMins: true } })
                .catch(() => null)
              if (mi) {
                eventMediaItemId = mi.id
                if (evContent.untilContentFinished || durationMins <= 0) durationMins = mi.durationMins
              }
            }
            if (durationMins <= 0) durationMins = 60

            const eventAdBreaks = deconflictAdBreaksForSlot(
              new Date(startTimeMs),
              durationMins,
              buildAdBreaks(durationMins, evSource === 'plex' ? adIntervalMovie : adIntervalTv, adEnabled),
            )
            const eventAdMins = eventAdBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
            const endMs = startTimeMs + (durationMins + eventAdMins) * 60_000
            if (reservedIntervals.some((r) => startTimeMs < r.end && endMs > r.start)) continue

            const eventSlot = await prisma.slot.create({
              data: {
                scheduleId:     schedule.id,
                startTime:      new Date(startTimeMs),
                durationMins,
                contentSource:  evSource === 'plex' ? 'plex' : 'youtube',
                contentId:      evSource === 'plex' ? evContentId : null,
                adBreaks:       eventAdBreaks.length ? toJson(eventAdBreaks) : null,
                fillerId:       evSource === 'plex' ? null : evContentId,
                fillerDuration: null,
                isOverride:     true,
                overrideReason: 'special_event',
                metadata:       toJson({ blockName: ev.name, title: ev.name, reason: 'special_event', priority: ev.priority, untilContentFinished: Boolean(evContent.untilContentFinished), onceOffEvent: Boolean(ev.onceOffEvent) }),
              },
            })
            if (eventMediaItemId) {
              await prisma.slotMediaItem
                .create({ data: { slotId: eventSlot.id, mediaItemId: eventMediaItemId, orderIndex: 0 } })
                .catch(() => null)
            }
            reservedIntervals.push({ start: startTimeMs, end: endMs })

            if (ev.onceOffEvent) {
              await prisma.specialEvent.update({
                where: { id: ev.id },
                data: { consumedAt: new Date() },
              }).catch(() => null)
            }
          }

          // ── Probabilistic marathons (FieldStation42-style) ──────────────────
          // A station slot may declare marathon { chance, count, hint }. When the
          // roll passes (and the optional date hint matches), the slot start is
          // taken over by `count` hours of back-to-back episodes of one series.
          for (const sb of stationBlocks) {
            const marathonCfg = sb.marathon
            if (!marathonCfg) continue

            const dateParts = getZonedParts(date, broadcastTimezone)
            if (!dateHintMatches(marathonCfg.hint, { month: dateParts.month, day: dateParts.day, weekday: broadcastWeekday })) continue

            // Deterministic roll: the same station/date/slot always rolls the
            // same result, so schedule regeneration cannot silently add or
            // remove a marathon that viewers may already have seen in the EPG.
            // Seed uses the broadcast-zone date so previews match generation.
            const broadcastDateStr = `${dateParts.year}-${String(dateParts.month).padStart(2, '0')}-${String(dateParts.day).padStart(2, '0')}`
            const marathonSeed = `${station.id}:${broadcastDateStr}:${sb.name}:${sb.startMins}:marathon`
            if (seededRandom01(marathonSeed) >= marathonCfg.chance) continue

            const mStart = atBroadcastTime(date, Math.floor(sb.startMins / 60), sb.startMins % 60, broadcastTimezone)
            const mEndMs = Math.min(mStart.getTime() + marathonCfg.count * 60 * 60_000, dayEndMs)
            if (mEndMs - mStart.getTime() < 30 * 60_000) continue
            if (reservedIntervals.some((r) => mStart.getTime() < r.end && mEndMs > r.start)) continue

            // Eligible series: slot filters + classification zone + ownership.
            const mMinsOfDay = getBroadcastMinutesOfDay(mStart, broadcastTimezone)
            const mCeil = classificationCeiling(date, mMinsOfDay, broadcastTimezone)
            const marathonPool = filterCandidatesBySlot(availableShows, sb, activeClassByPlexKey, activeClassBySectionKey)
              .filter((s) => ratingAllowed(s.contentRating, mCeil))
              .filter((s) => showIsOwnedByStation(showOwnership, s.ratingKey, station.id))
            if (!marathonPool.length) continue

            const marathonShow = weightedRandomWith(
              marathonPool.map((show) => ({ item: show, weight: Math.max(0.05, weightForItem(show, blocks[0])) })),
              mulberry32(seedToUInt32(`${marathonSeed}:show`)),
            )
            if (!marathonShow) continue

            const marathonEpisodes = await buildEpisodeSnapshotList(
              marathonShow.ratingKey,
              rules.allow_languages,
              rules.deny_languages,
              schedulerYearRange.minYear,
              schedulerYearRange.maxYear,
            ).catch(() => [] as EpisodeSnapshotItem[])
            if (marathonEpisodes.length < 2) continue

            // Start from the station's progression pointer when it exists so the
            // marathon binge picks up where the series airs, else from S01E01.
            const existingProgress = await prisma.showProgress.findUnique({
              where: { stationId_plexShowKey: { stationId: station.id, plexShowKey: marathonShow.ratingKey } },
              select: { nextSeason: true, nextEpisode: true },
            }).catch(() => null)
            let epIndex = existingProgress
              ? Math.max(0, marathonEpisodes.findIndex((e) => e.season === existingProgress.nextSeason && e.episode === existingProgress.nextEpisode))
              : Math.max(0, marathonEpisodes.indexOf(firstRegularEpisode(marathonEpisodes) ?? marathonEpisodes[0]))

            const marathonStrategy = sb.breakStrategy
            let cursor = new Date(mStart)
            let placedEpisodes = 0

            while (cursor.getTime() < mEndMs) {
              const episode = marathonEpisodes[epIndex % marathonEpisodes.length]
              epIndex += 1
              if (!episode) break
              if (dayUsedMediaKeys.has(episode.ratingKey)) continue

              const marathonEpRunMins = effectiveRuntimeMins(episode)
              const epAdBreaks = deconflictAdBreaksForSlot(
                cursor,
                marathonEpRunMins,
                buildContentAdBreaks({ durationMins: marathonEpRunMins, chapters: episode.chapters, markers: episode.markers }, adIntervalTv, adEnabled, marathonStrategy),
              )
              const epAdMins = epAdBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
              const remainMins = Math.floor((mEndMs - cursor.getTime()) / 60_000)
              if (marathonEpRunMins + epAdMins > remainMins + MAX_CONTENT_OVERRUN_MINS) break

              const epEnd = addMinutes(cursor, marathonEpRunMins + epAdMins)
              const mediaItem = await upsertMediaItem(episode)
              await prisma.slot.create({
                data: {
                  scheduleId:    schedule.id,
                  startTime:     cursor,
                  durationMins:  marathonEpRunMins,
                  contentSource: 'plex',
                  contentId:     episode.ratingKey,
                  showTitle:     episode.showTitle ?? marathonShow.title,
                  seasonNumber:  episode.seasonNumber,
                  episodeNumber: episode.episodeNumber,
                  adBreaks:      epAdBreaks.length ? toJson(epAdBreaks) : null,
                  isOverride:    true,
                  overrideReason: 'marathon',
                  metadata:      toJson({
                    blockName: sb.name,
                    title: `${marathonShow.title} Marathon`,
                    showTitle: episode.showTitle ?? marathonShow.title,
                    season: episode.seasonNumber,
                    episode: episode.episodeNumber,
                    reason: 'marathon',
                  }),
                  mediaItems:    { create: { mediaItemId: mediaItem.id, orderIndex: 0 } },
                },
              })

              incrementCount(dayTitleCounts, episode.showTitle ?? episode.title)
              incrementCount(daySeriesCounts, episode.showTitle)
              dayUsedMediaKeys.add(episode.ratingKey)
              recordAiring(globalAirings, episode.ratingKey, cursor.getTime(), epEnd.getTime())
              cursor = epEnd
              placedEpisodes += 1
            }

            if (!placedEpisodes) continue

            // Round the tail of the marathon to its window end with filler.
            const tailMins = Math.floor((mEndMs - cursor.getTime()) / 60_000)
            if (tailMins >= 1) {
              await prisma.slot.create({
                data: {
                  scheduleId:    schedule.id,
                  startTime:     cursor,
                  durationMins:  tailMins,
                  contentSource: 'youtube',
                  fillerId:      fillerPools.ads ?? fillerPools.music ?? null,
                  metadata:      toJson({ blockName: sb.name, title: 'Filler', reason: 'marathon_tail', showInEpg: false }),
                },
              })
            }

            reservedIntervals.push({ start: mStart.getTime(), end: mEndMs })
            console.log(`[Scheduler] Marathon: ${marathonShow.title} × ${placedEpisodes} eps on ${station.id} from ${mStart.toISOString()}`)
          }

          for (const block of blocks) {
            const blockStart = atBroadcastTime(date, block.startHour, block.startMin, broadcastTimezone)

            let blockEnd = atBroadcastTime(
              date,
              block.endHour === 24 ? 0 : block.endHour,
              block.endMin,
              broadcastTimezone,
            )
            if (block.endHour === 24 || blockEnd <= blockStart) {
              blockEnd = addBroadcastDays(blockEnd, 1, broadcastTimezone)
            }

            const blockDurationMins = differenceInMinutes(blockEnd, blockStart)
            if (blockDurationMins <= 0) continue

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

            // Holiday guardrail: when a holiday-tagged pool is active but its
            // unique items are exhausted for the day, fall back to the general
            // catalog instead of dropping straight to filler.
            const generalMovies = holidayTaggedMovies.length
              ? applyRatingCeiling(availableMovies, block.ratingCeiling).filter(
                  (m) => ratingAllowed(m.contentRating, block.ratingCeiling),
                )
              : validMovies
            const generalShows = holidayTaggedShows.length
              ? applyRatingCeiling(availableShows, block.ratingCeiling).filter(
                  (s) => ratingAllowed(s.contentRating, block.ratingCeiling),
                )
              : validShows

            let slotStart = new Date(blockStart)
            let failedPlacementsAtCurrentStart = 0

            while (differenceInMinutes(blockEnd, slotStart) >= 1) {
              const remainingMins = differenceInMinutes(blockEnd, slotStart)
              const effectiveContentType = getContentTypeForSlot(slotStart, block.contentType, stationBlocks, broadcastTimezone)

              const reservedHit = reservedIntervals.find((r) => {
                const t = slotStart.getTime()
                return t >= r.start && t < r.end
              })
              if (reservedHit) {
                slotStart = new Date(reservedHit.end)
                failedPlacementsAtCurrentStart = 0
                continue
              }

              const activeStationSlot = getMatchingStationBlock(slotStart, stationBlocks, broadcastTimezone)
              const applySlotFilter = !holidayContentOverride && !!activeStationSlot

              // Apply the Australian classification zone on top of the daypart's
              // own ceiling so nothing airs out of zone (e.g. no M before 8:30pm).
              const slotMinsOfDay = getBroadcastMinutesOfDay(slotStart, broadcastTimezone)
              const effCeiling = stricterRating(block.ratingCeiling, classificationCeiling(date, slotMinsOfDay, broadcastTimezone))
              const ceil = (items: PlexMediaItem[]) => items.filter((i) => ratingAllowed(i.contentRating, effCeiling))

              const slotMovies = ceil(applySlotFilter ? filterCandidatesBySlot(validMovies, activeStationSlot, activeClassByPlexKey, activeClassBySectionKey) : validMovies)
              const slotShows  = ceil(applySlotFilter ? filterCandidatesBySlot(validShows, activeStationSlot, activeClassByPlexKey, activeClassBySectionKey) : validShows)
              const slotMoviesFallback = ceil(applySlotFilter ? filterCandidatesBySlot(generalMovies, activeStationSlot, activeClassByPlexKey, activeClassBySectionKey) : generalMovies)
              const slotShowsFallback  = ceil(applySlotFilter ? filterCandidatesBySlot(generalShows, activeStationSlot, activeClassByPlexKey, activeClassBySectionKey) : generalShows)
              const slotRescueMovies = ceil(applySlotFilter ? filterCandidatesBySlot(rescueMovies, activeStationSlot, activeClassByPlexKey, activeClassBySectionKey) : rescueMovies)
              const slotLibWeights = applySlotFilter ? activeStationSlot?.libraryWeights : undefined
              const qualityCtx = { month: dayCalendarParts.month, day: dayCalendarParts.day, minutesOfDay: slotMinsOfDay }
              const libMultiplier = (item: PlexMediaItem) =>
                slotLibraryMultiplier(item, slotLibWeights, activeClassByPlexKey, activeClassBySectionKey)
                * contentQualityMultiplier(item, qualityCtx)
              // Per-slot break placement + opt-in alignment increment.
              const slotBreakStrategy = activeStationSlot?.breakStrategy
              const slotIncrement = activeStationSlot?.scheduleIncrement

              // Keys to avoid for this slot: anything already used today on this
              // station, anything on air right now on another station, plus every
              // movie aired on any channel within a week of this day (movies are
              // exclusive to one channel per rolling 7-day window).
              const excludeKeys = new Set<string>(dayUsedMediaKeys)
              for (const busyKey of keysAiringAt(globalAirings, slotStart.getTime())) {
                excludeKeys.add(busyKey)
              }
              for (const blockedMovie of weekBlockedMovies) {
                excludeKeys.add(blockedMovie)
              }

              if (failedPlacementsAtCurrentStart >= 6) {
                const rescuePool = applyRatingCeiling(slotRescueMovies, effCeiling)
                const rescueCandidates = rescuePool.length ? rescuePool : slotRescueMovies
                const rescueMovie = pickMovieCandidate(
                  rescueCandidates,
                  block,
                  remainingMins,
                  adIntervalMovie,
                  adEnabled,
                  dayTitleCounts,
                  () => 1,
                  { excludeKeys },
                )

                if (rescueMovie) {
                  const rescueAdBreaks = deconflictAdBreaksForSlot(
                    slotStart,
                    rescueMovie.durationMins,
                    buildContentAdBreaks(rescueMovie, adIntervalMovie, adEnabled, slotBreakStrategy),
                  )
                  const rescueAdMins   = rescueAdBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
                  const rescueSlotEnd  = addMinutes(slotStart, rescueMovie.durationMins + rescueAdMins)
                  const { effectiveEnd: rescueAligned, fillerMins: rescueFillerMins } = resolveWindowAlignedEnd(rescueSlotEnd, blockEnd, slotIncrement ?? 30, scheduleOffsetMins)

                  const mediaItem = await upsertMediaItem(rescueMovie)
                  const slot = await prisma.slot.create({
                    data: {
                      scheduleId:    schedule.id,
                      startTime:     slotStart,
                      durationMins:  rescueMovie.durationMins,
                      contentSource: 'plex',
                      contentId:     rescueMovie.ratingKey,
                      adBreaks:      rescueAdBreaks.length ? toJson(rescueAdBreaks) : null,
                      fillerId:      rescueFillerMins > 0 ? (fillerPools.ads ?? fillerPools.music ?? null) : null,
                      fillerDuration: rescueFillerMins > 0 ? rescueFillerMins : null,
                      metadata:      toJson({ blockName: block.name, title: rescueMovie.title, reason: 'placement_safety_rescue' }),
                      mediaItems:    { create: { mediaItemId: mediaItem.id, orderIndex: 0 } },
                    },
                  })
                  void slot
                  recordMediaUse(mediaItem.id)

                  incrementCount(dayTitleCounts, rescueMovie.title)
                  dayUsedMediaKeys.add(rescueMovie.ratingKey)
                  recordMovieClaim(date, rescueMovie.ratingKey)
                  recordAiring(globalAirings, rescueMovie.ratingKey, slotStart.getTime(), rescueAligned.getTime())
                  slotStart = rescueAligned
                  failedPlacementsAtCurrentStart = 0
                  continue
                }

                // No runtime-appropriate rescue content — fill the rest of the
                // block with filler in a single window rather than truncating a
                // long movie into a short slot.
                const fallbackDuration = remainingMins
                const fallbackAdBreaks = deconflictAdBreaksForSlot(
                  slotStart,
                  fallbackDuration,
                  buildAdBreaks(fallbackDuration, adIntervalTv, adEnabled),
                )
                await prisma.slot.create({
                  data: {
                    scheduleId:    schedule.id,
                    startTime:     slotStart,
                    durationMins:  fallbackDuration,
                    contentSource: 'youtube',
                    adBreaks:      fallbackAdBreaks.length ? toJson(fallbackAdBreaks) : null,
                    fillerId:      fillerPools.music ?? fillerPools.ads ?? null,
                    fillerDuration: null,
                    metadata:      toJson({
                      blockName: block.name,
                      title: 'Late Night Programming',
                      reason: 'placement_safety_fallback',
                      showInEpg: true,
                      fillerCategories: ['infomercial', 'ads', 'music'],
                    }),
                  },
                })
                slotStart = new Date(blockEnd)
                failedPlacementsAtCurrentStart = 0
                continue
              }

              const isNewsWindow = /news/i.test(String(activeStationSlot?.name ?? ''))
              const newsLiveVideoId = isNewsWindow
                ? String(activeStationSlot?.newsLiveVideoId ?? '').trim()
                : ''
              if (isNewsWindow && newsLiveVideoId) {
                // News slots can be bound to a dedicated YouTube live/video source.
                // This slot runs strictly for its own window duration only.
                await prisma.slot.create({
                  data: {
                    scheduleId:    schedule.id,
                    startTime:     slotStart,
                    durationMins:  remainingMins,
                    contentSource: 'youtube',
                    contentId:     newsLiveVideoId,
                    adBreaks:      null,
                    fillerId:      null,
                    fillerDuration: null,
                    metadata:      toJson({
                      blockName: block.name,
                      title: activeStationSlot?.name || block.name,
                      reason: 'news_live_window',
                      showInEpg: true,
                    }),
                  },
                })
                slotStart = new Date(blockEnd)
                failedPlacementsAtCurrentStart = 0
                continue
              }

              if (effectiveContentType === 'filler') {
                const isClosedownBlock = overnightClosedown && /infomercial/i.test(block.name)
                const closedownContent = isClosedownBlock ? resolveClosedownContent(rawRules) : null
                const windows: FillerWindow[] = (activeStationSlot?.fillerWindows?.length)
                  ? activeStationSlot.fillerWindows
                  : []

                // Creates a single YouTube filler slot for the given duration. For
                // close-down blocks the custom loop content (video/playlist) is used
                // and the close-down descriptor is stamped onto the slot metadata so
                // playback can show a graphic or loop the configured content.
                const createFillerSlot = async (
                  startAt: Date,
                  mins: number,
                  categories: string[],
                  titleOverride?: string,
                  bumpers?: { openBumperId?: string; closeBumperId?: string },
                  showInEpg = false,
                ) => {
                  if (mins < 1) return
                  const ads = deconflictAdBreaksForSlot(
                    startAt,
                    mins,
                    buildAdBreaks(mins, adIntervalTv, adEnabled),
                  )
                  const closedownYoutube = closedownContent && (closedownContent.type === 'youtube_video' || closedownContent.type === 'youtube_playlist')
                  const fid = closedownYoutube
                    ? closedownContent!.value
                    : (fillerPools.ads ?? fillerPools.music ?? null)
                  await prisma.slot.create({
                    data: {
                      scheduleId:    schedule.id,
                      startTime:     startAt,
                      durationMins:  mins,
                      contentSource: 'youtube',
                      adBreaks:      ads.length ? toJson(ads) : null,
                      fillerId:      fid,
                      fillerDuration: null,
                      metadata:      toJson({
                        blockName: block.name,
                        title: titleOverride ?? (isClosedownBlock ? 'Close Down' : block.name),
                        showInEpg,
                        fillerCategories: categories,
                        ...(closedownContent ? { closedown: closedownContent } : {}),
                        ...(bumpers?.openBumperId ? { openBumperId: bumpers.openBumperId } : {}),
                        ...(bumpers?.closeBumperId ? { closeBumperId: bumpers.closeBumperId } : {}),
                      }),
                    },
                  })
                }

                if (windows.length) {
                  // Honour each configured window in order.
                  for (const w of windows) {
                    const remain = differenceInMinutes(blockEnd, slotStart)
                    if (remain < 1) break
                    const winMins = Math.min(Math.max(0, Math.round(w.durationMins || 0)), remain)
                    if (winMins < 1) continue
                    const windowEndMs = addMinutes(slotStart, winMins).getTime()

                    if (w.plexShowKey) {
                      // Pinned Plex show: place its episodes, advancing progression.
                      const weekday = getBroadcastDayOfWeek(slotStart, broadcastTimezone)
                      const isStrip = Boolean(w.strip) && weekday >= 1 && weekday <= 5
                      const pinWeekday = isStrip ? STRIP_WEEKDAY : weekday
                      const cadenceDays = isStrip ? 1 : EPISODE_PROGRESS_INTERVAL_DAYS
                      const fillMode = w.fillMode === 'single' ? 'single' : 'fill'
                      const pinnedSnapshot = await buildEpisodeSnapshotList(
                        w.plexShowKey,
                        rules.allow_languages,
                        rules.deny_languages,
                        schedulerYearRange.minYear,
                        schedulerYearRange.maxYear,
                      )
                      const pinnedFirst = firstRegularEpisode(pinnedSnapshot)
                      let placed = 0

                      while (slotStart.getTime() < windowEndMs && (fillMode === 'fill' || placed < 1)) {
                        const timeStr = formatBroadcastTime(slotStart, broadcastTimezone)
                        let progress = await prisma.showProgress.upsert({
                          where: { stationId_plexShowKey: { stationId: station.id, plexShowKey: w.plexShowKey } },
                          update: {},
                          create: {
                            stationId:        station.id,
                            plexShowKey:      w.plexShowKey,
                            showTitle:        w.plexShowTitle ?? 'Pinned Show',
                            episodeOrderJson: toJson(pinnedSnapshot),
                            nextSeason:       pinnedFirst?.season ?? 1,
                            nextEpisode:      pinnedFirst?.episode ?? 1,
                            totalSeasons:     pinnedSnapshot.length ? Math.max(...pinnedSnapshot.map((e) => e.season)) : 1,
                            totalEpisodes:    pinnedSnapshot.length || 1,
                            airedWeekday:     pinWeekday,
                            airedTime:        timeStr,
                          },
                        }).catch(() => null)
                        if (!progress) break

                        const episodeOrder = await loadEpisodeSnapshot(
                          progress,
                          rules.allow_languages,
                          rules.deny_languages,
                          schedulerYearRange.minYear,
                          schedulerYearRange.maxYear,
                        )
                        // Sequence range: this window may be pinned to a fraction of
                        // the series (e.g. early seasons only). When the pointer
                        // falls outside the range, loop back to the range start.
                        const hasSequenceRange = w.sequenceStart != null || w.sequenceEnd != null
                        const rangedOrder = hasSequenceRange
                          ? applySequenceRange(episodeOrder, w.sequenceStart, w.sequenceEnd)
                          : episodeOrder
                        const pointerSeason = progress.nextSeason
                        const pointerEpisode = progress.nextEpisode
                        let episode = rangedOrder.find((e) => e.season === pointerSeason && e.episode === pointerEpisode) ?? null
                        if (!episode && hasSequenceRange && rangedOrder.length) {
                          episode = rangedOrder[0]
                          progress = await prisma.showProgress.update({
                            where: { id: progress.id },
                            data: { nextSeason: episode.season, nextEpisode: episode.episode, isCompleted: false },
                          }).catch(() => progress) ?? progress
                        }
                        if (!episode) break

                        const episodeRunMins = effectiveRuntimeMins(episode)
                        const adBreaks   = deconflictAdBreaksForSlot(
                          slotStart,
                          episodeRunMins,
                          buildContentAdBreaks({ durationMins: episodeRunMins, chapters: episode.chapters, markers: episode.markers }, adIntervalTv, adEnabled, activeStationSlot?.breakStrategy),
                        )
                        const adMins     = adBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
                        const remainWin = Math.max(0, Math.round((windowEndMs - slotStart.getTime()) / 60_000))
                        if (dayUsedMediaKeys.has(episode.ratingKey) || episodeRunMins + adMins > remainWin + MAX_CONTENT_OVERRUN_MINS) break

                        const slotEnd    = addMinutes(slotStart, episodeRunMins + adMins)

                        const mediaItem = await upsertMediaItem(episode)
                        const slot = await prisma.slot.create({
                          data: {
                            scheduleId:    schedule.id,
                            startTime:     slotStart,
                            durationMins:  episodeRunMins,
                            contentSource: 'plex',
                            contentId:     episode.ratingKey,
                            showTitle:     episode.showTitle ?? progress.showTitle,
                            seasonNumber:  episode.seasonNumber,
                            episodeNumber: episode.episodeNumber,
                            adBreaks:      adBreaks.length ? toJson(adBreaks) : null,
                            fillerId:      null,
                            fillerDuration: null,
                            metadata:      toJson({
                              blockName: block.name,
                              showTitle: episode.showTitle ?? progress.showTitle,
                              season:    episode.seasonNumber,
                              episode:   episode.episodeNumber,
                              reason:    'pinned_filler_show',
                            }),
                            mediaItems:    { create: { mediaItemId: mediaItem.id, orderIndex: 0 } },
                          },
                        })
                        void slot
                        recordMediaUse(mediaItem.id)
                        await advanceShowProgress(
                          progress,
                          cadenceDays,
                          rules.allow_languages,
                          rules.deny_languages,
                          schedulerYearRange.minYear,
                          schedulerYearRange.maxYear,
                        )

                        incrementCount(dayTitleCounts, episode.showTitle ?? episode.title)
                        incrementCount(daySeriesCounts, episode.showTitle)
                        dayUsedMediaKeys.add(episode.ratingKey)
                        recordAiring(globalAirings, episode.ratingKey, slotStart.getTime(), slotEnd.getTime())
                        slotStart = slotEnd
                        placed += 1
                      }

                      // Fill any leftover window time with filler. When the window
                      // played no pinned episodes it behaves like a plain filler
                      // window (open + close idents); otherwise only the closing
                      // ident rides the trailing filler at the window's end.
                      const remAfter = Math.min(differenceInMinutes(blockEnd, slotStart), Math.max(0, Math.round((windowEndMs - slotStart.getTime()) / 60_000)))
                      if (remAfter >= 1) {
                        const wb = fillerWindowBumpers(w)
                        const leftoverBumpers = placed === 0
                          ? wb
                          : (wb.closeBumperId ? { closeBumperId: wb.closeBumperId } : undefined)
                        await createFillerSlot(slotStart, remAfter, [w.category || 'filler'], w.displayName?.trim() || undefined, leftoverBumpers, true)
                        slotStart = addMinutes(slotStart, remAfter)
                      }
                    } else {
                      await createFillerSlot(slotStart, winMins, [w.category || 'filler'], w.displayName?.trim() || undefined, fillerWindowBumpers(w), true)
                      slotStart = addMinutes(slotStart, winMins)
                    }
                  }

                  // Any remaining block time after all windows → filler.
                  const rem = differenceInMinutes(blockEnd, slotStart)
                  if (rem >= 1) {
                    await createFillerSlot(slotStart, rem, isClosedownBlock ? ['closedown'] : ['filler', 'music'])
                  }
                  slotStart = new Date(blockEnd)
                  failedPlacementsAtCurrentStart = 0
                  continue
                }

                // No per-window config (engine filler/news block or close-down) →
                // a single filler block for the remainder.
                const fillerDuration = remainingMins
                const fillerCategories = isClosedownBlock
                    ? ['closedown']
                    : /infomercial/i.test(block.name)
                      ? ['infomercial']
                      : ['filler', 'music']
                await createFillerSlot(slotStart, fillerDuration, fillerCategories)
                slotStart = new Date(blockEnd)
                failedPlacementsAtCurrentStart = 0
                continue
              }

              const tryMovieBlock = effectiveContentType === 'movie'
                || (effectiveContentType === 'mixed' && shouldTryMovieInMixedBlock({
                  remainingMins,
                  validMovies: slotMovies.length,
                  validShows: slotShows.length,
                  daySeriesCounts,
                }))

              if (tryMovieBlock && (slotMovies.length || slotMoviesFallback.length)) {
                let chosen = pickMovieCandidate(slotMovies, block, remainingMins, adIntervalMovie, adEnabled, dayTitleCounts, libMultiplier, { excludeKeys })
                if (!chosen && holidayTaggedMovies.length) {
                  // Holiday-tagged movies are exhausted for now — fall back to the general pool.
                  chosen = pickMovieCandidate(slotMoviesFallback, block, remainingMins, adIntervalMovie, adEnabled, dayTitleCounts, libMultiplier, { excludeKeys })
                }
                if (!chosen) {
                  failedPlacementsAtCurrentStart += 1
                  continue
                }
                // Credits-aware effective runtime: don't broadcast long credit
                // rolls into the next boundary.
                const chosenRunMins = effectiveRuntimeMins(chosen)
                const adBreaks = deconflictAdBreaksForSlot(
                  slotStart,
                  chosenRunMins,
                  buildContentAdBreaks({ durationMins: chosenRunMins, chapters: chosen.chapters, markers: chosen.markers }, adIntervalMovie, adEnabled, slotBreakStrategy),
                )
                const adMins   = adBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
                const slotEnd  = addMinutes(slotStart, chosenRunMins + adMins)

                // Opt-in increment padding: buffer to the next boundary with filler.
                const { effectiveEnd: movieEffEnd, fillerMins: movieFillerMins } = slotIncrement != null
                  ? resolveWindowAlignedEnd(slotEnd, blockEnd, slotIncrement, scheduleOffsetMins)
                  : { effectiveEnd: slotEnd, fillerMins: 0 }

                const mediaItem = await upsertMediaItem(chosen)

                const slot = await prisma.slot.create({
                  data: {
                    scheduleId:    schedule.id,
                    startTime:     slotStart,
                    durationMins:  chosenRunMins,
                    contentSource: 'plex',
                    contentId:     chosen.ratingKey,
                    adBreaks:      adBreaks.length ? toJson(adBreaks) : null,
                    fillerId:      movieFillerMins > 0 ? (fillerPools.ads ?? fillerPools.music ?? null) : null,
                    fillerDuration: movieFillerMins > 0 ? movieFillerMins : null,
                    metadata:      toJson({
                      blockName: block.name,
                      title: chosen.title,
                      year: chosen.year,
                      ...(isPremiereItem(chosen) ? { premiere: true } : {}),
                      ...(anniversaryYears(chosen.originallyAvailableAt, dayCalendarParts.month, dayCalendarParts.day, dayCalendarParts.year) != null
                        ? { anniversaryYears: anniversaryYears(chosen.originallyAvailableAt, dayCalendarParts.month, dayCalendarParts.day, dayCalendarParts.year) }
                        : {}),
                      ...bumperMetaForWindow(activeStationSlot, windowBumperAssigned),
                    }),
                    mediaItems:    { create: { mediaItemId: mediaItem.id, orderIndex: 0 } },
                  },
                })
                void slot
                recordMediaUse(mediaItem.id)

                incrementCount(dayTitleCounts, chosen.title)
                dayUsedMediaKeys.add(chosen.ratingKey)
                recordMovieClaim(date, chosen.ratingKey)
                recordAiring(globalAirings, chosen.ratingKey, slotStart.getTime(), slotEnd.getTime())

                slotStart = movieEffEnd
                failedPlacementsAtCurrentStart = 0
                continue
              }

              if (
                (effectiveContentType === 'episode' || effectiveContentType === 'mixed') &&
                (slotShows.length || slotShowsFallback.length)
              ) {
                // Honour the holiday-tagged pool first; only widen to the general
                // catalog when the tagged pool yields no eligible series.
                const showSelectionPool = slotShows.length ? slotShows : slotShowsFallback
                const weekday = getBroadcastDayOfWeek(slotStart, broadcastTimezone)
                const timeStr = formatBroadcastTime(slotStart, broadcastTimezone)

                // Weeknight strip: Mon–Fri share one series at this time, advancing
                // one episode per day. Other slots pin per actual weekday + weekly.
                const isStrip = weekday >= 1 && weekday <= 5 && Boolean(activeStationSlot?.strip ?? block.strip)
                const pinWeekday = isStrip ? STRIP_WEEKDAY : weekday
                const cadenceDays = isStrip ? 1 : EPISODE_PROGRESS_INTERVAL_DAYS

                let progress = await prisma.showProgress.findFirst({
                  where: {
                    stationId:   station.id,
                    airedWeekday: pinWeekday,
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

                if (!progress) {
                  const weightedShows = buildWeightedShowPool(showSelectionPool, block, daySeriesCounts, libMultiplier)
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

                    const epList = await getCatalogEpisodeList(
                      show.ratingKey,
                      rules.allow_languages,
                      rules.deny_languages,
                      schedulerYearRange.minYear,
                      schedulerYearRange.maxYear,
                    ).catch(() => [])
                    if (!epList.length) {
                      continue
                    }
                    const firstEp = firstRegularEpisode(epList) ?? epList[0]

                    progress = await prisma.showProgress.upsert({
                      where: {
                        stationId_plexShowKey: {
                          stationId: station.id,
                          plexShowKey: show.ratingKey,
                        },
                      },
                      update: {
                        airedWeekday: pinWeekday,
                        airedTime: timeStr,
                        isCompleted: false,
                      },
                      create: {
                        stationId:     station.id,
                        plexShowKey:   show.ratingKey,
                        showTitle:     show.title,
                        episodeOrderJson: toJson(await buildEpisodeSnapshotList(
                          show.ratingKey,
                          rules.allow_languages,
                          rules.deny_languages,
                          schedulerYearRange.minYear,
                          schedulerYearRange.maxYear,
                        )),
                        nextSeason:    firstEp.season,
                        nextEpisode:   firstEp.episode,
                        totalSeasons:  Math.max(...epList.map((e) => e.season)),
                        totalEpisodes: epList.length,
                        airedWeekday:  pinWeekday,
                        airedTime:     timeStr,
                      },
                    })

                    if (!showOwnership.has(show.ratingKey)) {
                      showOwnership.set(show.ratingKey, station.id)
                    }
                  }
                }

                if (progress) {
                  const episodeOrder = await loadEpisodeSnapshot(
                    progress,
                    rules.allow_languages,
                    rules.deny_languages,
                    schedulerYearRange.minYear,
                    schedulerYearRange.maxYear,
                  )
                  const episode = episodeOrder.find(
                    (ref) => ref.season === progress.nextSeason && ref.episode === progress.nextEpisode,
                  ) ?? null

                  if (episode) {
                    // Skip without retiring the series when the episode is already
                    // used today on this station, already on air on another
                    // station, or too long for the time remaining. Preserving the
                    // progression pointer keeps the series alive for later slots.
                    const episodeRunMins = effectiveRuntimeMins(episode)
                    const episodeAdBreaks = deconflictAdBreaksForSlot(
                      slotStart,
                      episodeRunMins,
                      buildContentAdBreaks({ durationMins: episodeRunMins, chapters: episode.chapters, markers: episode.markers }, adIntervalTv, adEnabled, slotBreakStrategy),
                    )
                    const episodeAdMins = episodeAdBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
                    const episodeTooLong = episodeRunMins + episodeAdMins > remainingMins + MAX_CONTENT_OVERRUN_MINS
                    if (excludeKeys.has(episode.ratingKey) || episodeTooLong) {
                      failedPlacementsAtCurrentStart += 1
                      continue
                    }

                    const adBreaks   = episodeAdBreaks
                    const adMins     = adBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
                    const slotEnd    = addMinutes(slotStart, episodeRunMins + adMins)

                    // Opt-in increment padding for episodic content.
                    const { effectiveEnd: epEffEnd, fillerMins: epFillerMins } = slotIncrement != null
                      ? resolveWindowAlignedEnd(slotEnd, blockEnd, slotIncrement, scheduleOffsetMins)
                      : { effectiveEnd: slotEnd, fillerMins: 0 }

                    const mediaItem = await upsertMediaItem(episode)
                    const slot = await prisma.slot.create({
                      data: {
                        scheduleId:    schedule.id,
                        startTime:     slotStart,
                        durationMins:  episodeRunMins,
                        contentSource: 'plex',
                        contentId:     episode.ratingKey,
                        showTitle:     episode.showTitle ?? progress.showTitle,
                        seasonNumber:  episode.seasonNumber,
                        episodeNumber: episode.episodeNumber,
                        adBreaks:      adBreaks.length ? toJson(adBreaks) : null,
                        fillerId:      epFillerMins > 0 ? (fillerPools.ads ?? fillerPools.music ?? null) : null,
                        fillerDuration: epFillerMins > 0 ? epFillerMins : null,
                        metadata:      toJson({
                          blockName: block.name,
                          showTitle: episode.showTitle ?? progress.showTitle,
                          season:    episode.seasonNumber,
                          episode:   episode.episodeNumber,
                          ...(anniversaryYears(episode.airDate, dayCalendarParts.month, dayCalendarParts.day, dayCalendarParts.year) != null
                            ? { anniversaryYears: anniversaryYears(episode.airDate, dayCalendarParts.month, dayCalendarParts.day, dayCalendarParts.year) }
                            : {}),
                          ...bumperMetaForWindow(activeStationSlot, windowBumperAssigned),
                        }),
                        mediaItems:    { create: { mediaItemId: mediaItem.id, orderIndex: 0 } },
                      },
                    })
                    void slot
                    recordMediaUse(mediaItem.id)
                    recordParentShowUse(progress.plexShowKey)

                    await advanceShowProgress(
                      progress,
                      cadenceDays,
                      rules.allow_languages,
                      rules.deny_languages,
                      schedulerYearRange.minYear,
                      schedulerYearRange.maxYear,
                    )

                    incrementCount(dayTitleCounts, episode.showTitle ?? episode.title)
                    incrementCount(daySeriesCounts, episode.showTitle)
                    dayUsedMediaKeys.add(episode.ratingKey)
                    recordAiring(globalAirings, episode.ratingKey, slotStart.getTime(), slotEnd.getTime())

                    slotStart = epEffEnd
                    failedPlacementsAtCurrentStart = 0
                    continue
                  }

                  await prisma.showProgress.update({
                    where: { id: progress.id },
                    data: { isCompleted: true, lastAiredAt: new Date() },
                  }).catch(() => null)
                  failedPlacementsAtCurrentStart += 1
                  continue
                }
              }

              const fallbackDuration = Math.max(1, Math.min(30, remainingMins))
              const fallbackAdBreaks = deconflictAdBreaksForSlot(
                slotStart,
                fallbackDuration,
                buildAdBreaks(fallbackDuration, adIntervalTv, adEnabled),
              )

              const rescuePool = applyRatingCeiling(slotRescueMovies, effCeiling)
              const rescueCandidates = rescuePool.length ? rescuePool : slotRescueMovies
              const rescueMovie = pickMovieCandidate(
                rescueCandidates,
                block,
                remainingMins,
                adIntervalMovie,
                adEnabled,
                dayTitleCounts,
                () => 1,
                { excludeKeys },
              )

              if (rescueMovie) {
                const rescueAdBreaks = deconflictAdBreaksForSlot(
                  slotStart,
                  rescueMovie.durationMins,
                  buildContentAdBreaks(rescueMovie, adIntervalMovie, adEnabled, slotBreakStrategy),
                )
                const rescueAdMins   = rescueAdBreaks.reduce((sum, ab) => sum + ab.durationMins, 0)
                const rescueSlotEnd  = addMinutes(slotStart, rescueMovie.durationMins + rescueAdMins)

                const mediaItem = await upsertMediaItem(rescueMovie)
                const slot = await prisma.slot.create({
                  data: {
                    scheduleId:    schedule.id,
                    startTime:     slotStart,
                    durationMins:  rescueMovie.durationMins,
                    contentSource: 'plex',
                    contentId:     rescueMovie.ratingKey,
                    adBreaks:      rescueAdBreaks.length ? toJson(rescueAdBreaks) : null,
                    fillerId:      null,
                    fillerDuration: null,
                    metadata:      toJson({ blockName: block.name, title: rescueMovie.title, reason: 'fallback_rescue' }),
                    mediaItems:    { create: { mediaItemId: mediaItem.id, orderIndex: 0 } },
                  },
                })
                void slot
                recordMediaUse(mediaItem.id)

                incrementCount(dayTitleCounts, rescueMovie.title)
                dayUsedMediaKeys.add(rescueMovie.ratingKey)
                recordMovieClaim(date, rescueMovie.ratingKey)
                recordAiring(globalAirings, rescueMovie.ratingKey, slotStart.getTime(), rescueSlotEnd.getTime())
                slotStart = rescueSlotEnd
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
                  metadata:      toJson({ blockName: block.name, title: 'Filler', reason: 'fallback_filler', showInEpg: false }),
                },
              })
              slotStart = addMinutes(slotStart, fallbackDuration)
              failedPlacementsAtCurrentStart = 0
            }
          }

          // Flush deferred usage counters in grouped updates.
          await flushUsageCounts()

          await persistStatus({
            daysProcessed: runStatus.daysProcessed + 1,
            daysCreated: runStatus.daysCreated + 1,
            note: `Scheduled ${station.id} for ${date.toISOString().split('T')[0]}`,
          })
          console.log(`[Scheduler] Scheduled ${station.id} for ${date.toISOString().split('T')[0]}`)
        } catch (err) {
          await persistStatus({
            lastError: err instanceof Error ? err.message : String(err),
            note: `Failed ${station.id} for ${date.toISOString().split('T')[0]}`,
          })
          console.error(`[Scheduler] Failed ${station.id} for ${date.toISOString().split('T')[0]}:`, err)
        }
      }
      await persistStatus({
        stationsProcessed: runStatus.stationsProcessed + 1,
        note: `Completed station ${station.id}`,
      })
    }

    await persistStatus({
      isRunning: false,
      phase: 'complete',
      finishedAt: new Date().toISOString(),
      note: 'Scheduler run complete',
    })
    console.log('[Scheduler] Run complete.')
  } catch (error) {
    await persistStatus({
      isRunning: false,
      phase: 'error',
      finishedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
      note: 'Scheduler run failed',
    })
    throw error
  } finally {
    schedulerIsRunning = false
  }
}

// ─── Episode pointer advancement ─────────────────────────────────────────────

async function advanceShowProgress(
  progress: { id: string; nextSeason: number; nextEpisode: number; plexShowKey: string; totalEpisodes: number; episodeOrderJson?: string | null; lastAiredAt?: Date | null },
  cadenceDays: number = EPISODE_PROGRESS_INTERVAL_DAYS,
  allowLanguages?: string[],
  denyLanguages?: string[],
  yearMin?: number | null,
  yearMax?: number | null,
): Promise<void> {
  const now = new Date()
  if (!progress.lastAiredAt) {
    // First run pins the first episode and starts the progression timer.
    await prisma.showProgress.update({
      where: { id: progress.id },
      data: { lastAiredAt: now },
    })
    return
  }

  const msSinceLastAdvance = now.getTime() - progress.lastAiredAt.getTime()
  const minAdvanceMs = Math.max(1, cadenceDays) * 24 * 60 * 60 * 1000
  if (msSinceLastAdvance < minAdvanceMs) {
    // Hold on the same episode until the configured cadence is reached.
    return
  }

  const storedSnapshot = parseEpisodeSnapshot(progress.episodeOrderJson)
  const epList = storedSnapshot.length
    ? storedSnapshot
    : await buildEpisodeSnapshotList(progress.plexShowKey, allowLanguages, denyLanguages, yearMin, yearMax)
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
    const firstRef = firstRegularEpisode(epList) ?? epList[0]
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
// Runs once immediately, then reschedules itself after each run using the
// current DB interval setting so changes take effect without a restart.

import {
  getSchedulerHorizonDays,
  getSchedulerIntervalHours,
  DEFAULT_SCHEDULER_HORIZON_DAYS,
  DEFAULT_SCHEDULER_INTERVAL_HOURS,
} from './app-settings'

let schedulerTimer: ReturnType<typeof setTimeout> | null = null
let schedulerStarted = false

async function scheduleNextRun(): Promise<void> {
  const intervalHours = await getSchedulerIntervalHours().catch(() => DEFAULT_SCHEDULER_INTERVAL_HOURS)
  const intervalMs    = Math.max(60_000, intervalHours * 60 * 60 * 1000)
  schedulerTimer = setTimeout(async () => {
    const horizonDays = await getSchedulerHorizonDays().catch(() => DEFAULT_SCHEDULER_HORIZON_DAYS)
    runScheduler(horizonDays).catch((err) => {
      console.error('[Scheduler] Error during auto-run:', err)
    })
    scheduleNextRun()
  }, intervalMs)
  console.log(`[Scheduler] Next auto-run scheduled in ${intervalHours}h.`)
}

export function startScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  console.log('[Scheduler] Auto-scheduler starting.')
  setTimeout(async () => {
    const horizonDays = await getSchedulerHorizonDays().catch(() => DEFAULT_SCHEDULER_HORIZON_DAYS)
    runScheduler(horizonDays).catch((err) => {
      console.error('[Scheduler] Error during initial auto-run:', err)
    })
    scheduleNextRun()
  }, 5_000)
}

/** Re-schedule the next auto-run immediately with current DB settings.
 *  Call this after saving scheduler interval or horizon settings. */
export function restartScheduler(): void {
  if (!schedulerStarted) return
  if (schedulerTimer) { clearTimeout(schedulerTimer); schedulerTimer = null }
  scheduleNextRun()
}

// ─── Day preview (dry run) ───────────────────────────────────────────────────
// Resolves what a station's lineup WOULD look like on a given date without
// writing anything: effective windows (incl. date overrides + presets),
// holiday detection, and marathon outcomes. Marathon rolls use the same
// deterministic seed as real generation, so the preview is faithful.

export interface StationDayPreview {
  stationId: string
  date: string            // YYYY-MM-DD
  dayName: string
  isWeekend: boolean
  holiday: string | null
  channelType: string
  dateOverrideApplied: boolean
  scheduleOffsetMins: number
  blocks: Array<{
    name: string
    start: string          // HH:MM
    end: string            // HH:MM
    contentType: string
    allowGenres: string[]
    breakStrategy: string | null
    scheduleIncrement: number | null
    strip: boolean
    fillerWindows: number
    marathon: { chance: number; count: number; hint?: string; wouldTrigger: boolean } | null
  }>
}

export async function previewStationDay(stationId: string, dateStr: string): Promise<StationDayPreview | null> {
  const station = await prisma.station.findUnique({ where: { id: stationId } })
  if (!station) return null

  const broadcastTimezone = await getBroadcastTimezone()
  const m = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const date = zonedTimeToUtc(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, broadcastTimezone)

  const rawRules = fromJsonObject<Record<string, unknown>>(station.rules)
  const channelType = String(rawRules.channel_type ?? 'standard').trim().toLowerCase() || 'standard'
  const weekdayNum = getBroadcastDayOfWeek(date, broadcastTimezone)
  const isWeekend = [0, 6].includes(weekdayNum)
  const parts = getZonedParts(date, broadcastTimezone)

  const holidaySettings = await loadHolidaySettings()
  const holiday = getHolidayForDate(date, holidaySettings)

  // Detect whether any date override matches this calendar date.
  const overrides = Array.isArray(rawRules.date_overrides)
    ? (rawRules.date_overrides as Array<Record<string, unknown>>)
    : []
  const dateOverrideApplied = overrides.some((entry) => {
    const dates = String(entry?.dates ?? '').trim()
    return Boolean(dates) && dateHintMatches(dates, { month: parts.month, day: parts.day, weekday: weekdayNum })
  })

  const stationBlocks = channelType === 'standard'
    ? resolveStationTimeBlocks(date, rawRules, broadcastTimezone)
    : []

  const fmt = (mins: number) => `${String(Math.floor((mins % 1440) / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
  const scheduleOffsetMins = (() => {
    const n = Number(rawRules.schedule_offset ?? 0)
    return Number.isFinite(n) ? Math.max(0, Math.min(29, Math.round(n))) : 0
  })()

  return {
    stationId,
    date: dateStr,
    dayName: dayNameForDate(date, broadcastTimezone),
    isWeekend,
    holiday,
    channelType,
    dateOverrideApplied,
    scheduleOffsetMins,
    blocks: stationBlocks.map((sb) => {
      let marathon: StationDayPreview['blocks'][number]['marathon'] = null
      if (sb.marathon) {
        const hintMatches = dateHintMatches(sb.marathon.hint, { month: parts.month, day: parts.day, weekday: weekdayNum })
        const marathonSeed = `${stationId}:${dateStr}:${sb.name}:${sb.startMins}:marathon`
        marathon = {
          chance: sb.marathon.chance,
          count: sb.marathon.count,
          hint: sb.marathon.hint,
          wouldTrigger: hintMatches && seededRandom01(marathonSeed) < sb.marathon.chance,
        }
      }
      return {
        name: sb.name,
        start: fmt(sb.startMins),
        end: sb.endMins >= 24 * 60 ? '24:00' : fmt(sb.endMins),
        contentType: sb.contentType,
        allowGenres: sb.allowGenres ?? [],
        breakStrategy: sb.breakStrategy ?? null,
        scheduleIncrement: sb.scheduleIncrement ?? null,
        strip: Boolean(sb.strip),
        fillerWindows: sb.fillerWindows?.length ?? 0,
        marathon,
      }
    }),
  }
}
