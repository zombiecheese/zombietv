// Real-Time Playback Engine
// Given a stationId + the current UTC timestamp, returns exactly what
// that station is broadcasting right now, how far through it we are,
// and when the next transition happens.
//
// This is the server's single source of truth for all clients.
// Clients call GET /api/now/[stationId] and receive a PlaybackState.

import { prisma }                         from './db'
import { fromJsonArray, fromJsonObject }  from './json'
import { getBroadcastTimezone }          from './app-settings'
import { getZonedParts, zonedTimeToUtc } from './time'
import { filterPoolByHints }             from './date-hints'
import { seededShuffle }                 from './seeded-random'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdBreakDef {
  offsetMins:  number
  durationMins: number
}

export interface UpNextInfo {
  title:         string
  showTitle:     string | null
  seasonNumber:  number | null
  episodeNumber: number | null
  startsAtMs:    number
  thumbPath:     string | null   // Plex poster path — render via /api/plex-art
  premiere:      boolean         // first airing of a fresh library addition
  anniversaryYears: number | null // "first aired N years ago tonight"
}

export interface PlaybackState {
  stationId:       string
  serverTimeMs:    number          // Server's current UTC epoch ms — clients use this to sync

  // What is on air right now
  contentSource:   'plex' | 'youtube' | 'filler' | 'ad' | 'offline' | 'weather' | 'guide' | 'web' | 'stream'
  contentId:       string | null   // Plex ratingKey or YouTube video/playlist ID
  title:           string | null
  showTitle:       string | null
  seasonNumber:    number | null
  episodeNumber:   number | null
  contentRating:   string | null

  // Where in the content we are
  startOffsetMs:   number          // How many ms into contentId the client should seek to
  slotStartMs:     number          // Absolute UTC ms when the current slot began
  slotEndMs:       number          // Absolute UTC ms when the current slot ends

  // If we're currently in an ad break
  inAdBreak:       boolean
  adFillerId:      string | null   // YouTube playlist/video ID for ads
  adBreakEndsMs:   number | null   // Absolute UTC ms when the ad break ends
  youtubeQueue:    string[] | null  // Ordered YouTube video IDs selected for this segment

  // When the next thing starts (either end of ad break or end of slot)
  nextTransitionMs: number

  // All ad breaks remaining in this slot (so client can pre-plan)
  upcomingAdBreaks: Array<{ startsAtMs: number; durationMins: number }>

  // Filler info (content that runs after main program to fill to hour/half-hour)
  inFiller:        boolean
  fillerStartMs:   number | null
  fillerId:        string | null

  // Bumper info (opening/closing idents for the current slot)
  openBumperId:    string | null  // YouTube video ID for opening bumper
  closeBumperId:   string | null  // YouTube video ID for closing bumper

  // Overnight close-down: a static graphic to display full-screen (looped
  // YouTube video/playlist close-downs come through the normal filler path).
  offlineGraphicUrl: string | null

  // Non-standard channel types (weather / guide / web / stream / loop).
  // 'standard' for scheduled broadcast stations.
  channelType:     string
  channelConfig:   Record<string, unknown> | null

  // The next scheduled programme (for dynamic "Up Next" cards during breaks).
  upNext:          UpNextInfo | null

  // True while a live news window airs (viewer shows a corner clock bug).
  newsLive:        boolean
}

interface YoutubePoolItem {
  videoId: string
  title: string
  durationMins: number | null
  category: string
  station: string | null
}

interface YoutubeSelection {
  currentVideoId: string
  queue: string[]
  startOffsetMs: number
}

type AdPoolCandidate = {
  videoId: string | null
  durationMins: number | null
  station: string | null
  category: string
}

type AdPoolItem = {
  videoId: string
  durationMins: number | null
  station: string | null
}

type SlotRecord = {
  startTime: Date
  durationMins: number
  fillerDuration: number | null
  adBreaks: string | null
  metadata: string | null
  contentSource: string
  fillerId: string | null
  contentId: string | null
  showTitle: string | null
  seasonNumber: number | null
  episodeNumber: number | null
}

function hasVideoId<T extends { videoId: string | null }>(item: T): item is T & { videoId: string } {
  return typeof item.videoId === 'string' && item.videoId.length > 0
}

function preferStationScopedItems<T extends { station: string | null }>(items: T[], stationId: string): T[] {
  const stationItems = items.filter((item) => item.station === stationId)
  if (stationItems.length) return stationItems
  return items.filter((item) => item.station == null)
}

function isOvernightAdBreakWindow(now: Date, timezone: string): boolean {
  const hour = getZonedParts(now, timezone).hour
  return hour >= 1 && hour < 5
}

// ─── Main function ────────────────────────────────────────────────────────────

export async function getPlaybackState(stationId: string, nowMs?: number): Promise<PlaybackState> {
  const now = nowMs ?? Date.now()
  const nowDate = new Date(now)
  const broadcastTimezone = await getBroadcastTimezone()
  const preferInfomercialAds = isOvernightAdBreakWindow(nowDate, broadcastTimezone)

  const offline: PlaybackState = {
    stationId,
    serverTimeMs:     now,
    contentSource:    'offline',
    contentId:        null,
    title:            null,
    showTitle:        null,
    seasonNumber:     null,
    episodeNumber:    null,
    contentRating:    null,
    startOffsetMs:    0,
    slotStartMs:      now,
    slotEndMs:        now,
    inAdBreak:        false,
    adFillerId:       null,
    adBreakEndsMs:    null,
    youtubeQueue:     null,
    nextTransitionMs: now + 60_000,
    upcomingAdBreaks: [],
    inFiller:         false,
    fillerStartMs:    null,
    fillerId:         null,
    openBumperId:     null,
    closeBumperId:    null,
    offlineGraphicUrl: null,
    channelType:      'standard',
    channelConfig:    null,
    upNext:           null,
    newsLive:         false,
  }

  const station = await prisma.station.findUnique({
    where: { id: stationId },
    select: { fillerPools: true, rules: true },
  })
  const fillerPools = fromJsonObject<Record<string, string | null>>(station?.fillerPools)
  const stationRules = fromJsonObject<Record<string, unknown>>(station?.rules)

  // ── Non-standard channel types short-circuit the schedule entirely ──────
  const channelType = String(stationRules.channel_type ?? 'standard').trim().toLowerCase()
  if (channelType !== 'standard' && channelType !== '') {
    const typeState = buildChannelTypeState({ offline, channelType, stationRules, now })
    if (typeState) return typeState
    return offline
  }

  const buildGapFillerState = (nextTransitionMs: number): PlaybackState => {
    const fallbackId = fillerPools.music ?? fillerPools.ads ?? null
    if (!fallbackId) {
      return {
        ...offline,
        nextTransitionMs,
      }
    }

    return {
      stationId,
      serverTimeMs: now,
      contentSource: 'filler',
      contentId: fallbackId,
      title: null,
      showTitle: null,
      seasonNumber: null,
      episodeNumber: null,
      contentRating: null,
      startOffsetMs: 0,
      slotStartMs: now,
      slotEndMs: nextTransitionMs,
      inAdBreak: false,
      adFillerId: null,
      adBreakEndsMs: null,
      youtubeQueue: [fallbackId],
      nextTransitionMs,
      upcomingAdBreaks: [],
      inFiller: true,
      fillerStartMs: now,
      fillerId: fallbackId,
      openBumperId: null,
      closeBumperId: null,
      offlineGraphicUrl: null,
      channelType: 'standard',
      channelConfig: null,
      upNext: null,
      newsLive: false,
    }
  }

  // ── Find the active schedule for today ──────────────────────────────────
  // Resolve schedule boundaries in the configured broadcast timezone so
  // weekday/weekend day partitions and overnight windows stay aligned.
  const nowParts = getZonedParts(nowDate, broadcastTimezone)
  const yesterdayMidnight = zonedTimeToUtc(nowParts.year, nowParts.month - 1, nowParts.day - 1, 0, 0, broadcastTimezone)
  const tomorrowMidnight = zonedTimeToUtc(nowParts.year, nowParts.month - 1, nowParts.day + 1, 0, 0, broadcastTimezone)

  const schedules = await prisma.schedule.findMany({
    where: {
      stationId,
      isActive: true,
      date: {
        // Include previous day so slots that started before midnight
        // can still be active after midnight.
        gte: yesterdayMidnight,
        lt: tomorrowMidnight,
      },
    },
    include: {
      slots: {
        orderBy: { startTime: 'asc' },
        select: {
          startTime: true,
          durationMins: true,
          fillerDuration: true,
          adBreaks: true,
          metadata: true,
          contentSource: true,
          fillerId: true,
          contentId: true,
          showTitle: true,
          seasonNumber: true,
          episodeNumber: true,
        },
      },
    },
    orderBy: { date: 'asc' },
  })

  if (!schedules.length) return offline

  const allSlots: SlotRecord[] = schedules
    .flatMap((schedule) => schedule.slots)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())

  if (!allSlots.length) return offline

  // ── Find the active slot ────────────────────────────────────────────────
  const activeSlot = allSlots.reduce<SlotRecord | null>((latest, slot) => {
    const slotStart = slot.startTime.getTime()
    // Ad breaks add to the programme's wall-clock runtime.
    const slotAdMins = fromJsonArray<AdBreakDef>(slot.adBreaks).reduce((sum, ab) => sum + (ab.durationMins || 0), 0)
    const slotEnd = slotStart + (slot.durationMins + slotAdMins) * 60_000

    // Also account for filler that extends the slot
    const effectiveEnd = slot.fillerDuration
      ? slotEnd + slot.fillerDuration * 60_000
      : slotEnd

    if (!(now >= slotStart && now < effectiveEnd)) return latest
    if (!latest) return slot
    return slotStart > latest.startTime.getTime() ? slot : latest
  }, null)

  if (!activeSlot) {
    const nextSlot = allSlots.find((slot) => slot.startTime.getTime() > now)
    const nextTransitionMs = nextSlot?.startTime.getTime() ?? (now + 60_000)
    return buildGapFillerState(nextTransitionMs)
  }

  const slotStartMs    = activeSlot.startTime.getTime()
  const elapsedMs      = now - slotStartMs

  // ── Calculate ad breaks (ads add to wall-clock runtime) ───────────────────
  const adBreakDefs: AdBreakDef[] = fromJsonArray<AdBreakDef>(activeSlot.adBreaks)

  // Pre-fetch the ad-eligible pool once so each ad break can extend its end to
  // the completion of the last ad video — ads always play to the end before the
  // main programme resumes.
  // Availability-hint context (day part + calendar date) in the broadcast zone.
  const hintCtx = {
    minutesOfDay: nowParts.hour * 60 + nowParts.minute,
    month: nowParts.month,
    day: nowParts.day,
  }

  const adPoolRaw: Array<AdPoolCandidate & { dayParts: string | null; dateRange: string | null; exclusive: boolean }> = adBreakDefs.length
    ? await prisma.youtubeContent.findMany({
        where: {
          category: { in: preferInfomercialAds ? ['infomercial', 'ads', 'music'] : ['ads', 'filler', 'music'] },
          OR: [{ station: null }, { station: stationId }],
        },
        select: { videoId: true, durationMins: true, station: true, category: true, dayParts: true, dateRange: true, exclusive: true },
      })
    : []
  const adPool: AdPoolItem[] = preferStationScopedItems(
    filterPoolByHints(adPoolRaw, hintCtx)
      .filter(hasVideoId)
      .sort((left, right) => {
        if (!preferInfomercialAds) return 0
        const leftRank = left.category === 'infomercial' ? 0 : 1
        const rightRank = right.category === 'infomercial' ? 0 : 1
        return leftRank - rightRank
      }),
    stationId,
  )

  // For a given ad break, return the absolute time at which the last ad video
  // that covers its nominal window finishes (>= the nominal end time).
  function adBreakEffectiveEnd(startsAtMs: number, nominalDurationMins: number): number {
    const nominalEnd = startsAtMs + nominalDurationMins * 60_000
    if (!adPool.length) return nominalEnd
    const ordered = seededShuffle(adPool, `${stationId}:${slotStartMs}:${startsAtMs}:ad`)
    let cursorMs = startsAtMs
    const nominalMs = nominalDurationMins * 60_000
    let coveredMs = 0
    for (const item of ordered) {
      const durMs = Math.max(1, item.durationMins ?? 3) * 60_000
      cursorMs += durMs
      coveredMs += durMs
      if (coveredMs >= nominalMs) break
    }
    return Math.max(nominalEnd, cursorMs)
  }

  // Ad breaks are positioned in wall-clock time: each break's content-relative
  // offset is shifted by the total ad time that has already played before it.
  // Ad time therefore LENGTHENS the programme rather than overwriting content.
  let cumulativeAdMs = 0
  const adBreaksAbsolute = adBreakDefs.map((ab) => {
    const startsAtMs = slotStartMs + ab.offsetMins * 60_000 + cumulativeAdMs
    const endsAtMs   = adBreakEffectiveEnd(startsAtMs, ab.durationMins)
    const effDurMs   = endsAtMs - startsAtMs
    cumulativeAdMs += effDurMs
    return {
      startsAtMs,
      endsAtMs,
      durationMins: effDurMs / 60_000,
    }
  })
  const totalAdMs = cumulativeAdMs

  // Content wall-end includes the ad time so the full programme plays out.
  const contentEndMs   = slotStartMs + activeSlot.durationMins * 60_000 + totalAdMs
  const fillerEndMs    = activeSlot.fillerDuration
    ? contentEndMs + activeSlot.fillerDuration * 60_000
    : contentEndMs
  const slotEndMs      = fillerEndMs

  // ── Are we in the filler zone? ──────────────────────────────────────────
  const inFiller = now >= contentEndMs && now < fillerEndMs

  // Current ad break
  const currentAdBreak = adBreaksAbsolute.find(
    (ab) => now >= ab.startsAtMs && now < ab.endsAtMs,
  )

  const inAdBreak    = !inFiller && currentAdBreak !== undefined
  const adBreakEndsMs = inAdBreak ? currentAdBreak!.endsAtMs : null

  // ── Fetch station filler pool for ads ────────────────────────────────────
  // Extract filler window info from slot metadata (for filler-only slots/windows)
  const slotMetadata = fromJsonObject<Record<string, unknown>>(activeSlot.metadata) ?? {}

  // Overnight close-down with a static graphic: show it full-screen on the
  // offline layer. (Video/playlist close-downs carry their id in fillerId and
  // fall through to the normal looped-filler path below.)
  const closedown = slotMetadata.closedown as { type?: string; value?: string } | undefined
  if (closedown && closedown.type === 'graphic' && closedown.value) {
    return {
      ...offline,
      serverTimeMs:     now,
      slotStartMs,
      slotEndMs,
      nextTransitionMs: slotEndMs,
      offlineGraphicUrl: String(closedown.value),
    }
  }

  let fillerCategories: string[] = ['ads', 'music', 'infomercial']
  
  // Check for new fillerWindows format
  if (Array.isArray(slotMetadata?.fillerWindows)) {
    const windows = slotMetadata.fillerWindows as Array<{ category?: string }>
    const categoriesSet = new Set<string>()
    for (const w of windows) {
      if (typeof w.category === 'string') categoriesSet.add(w.category)
    }
    if (categoriesSet.size > 0) fillerCategories = Array.from(categoriesSet)
  } else if (Array.isArray(slotMetadata?.fillerCategories)) {
    // Legacy support for old fillerCategories field
    fillerCategories = slotMetadata.fillerCategories as string[]
  }

  // Per-window opening/closing idents (bumpers) live on the filler-window slot
  // metadata. They are only injected for dedicated youtube filler slots so they
  // stay strictly bounded to that window: the opener plays at the window start
  // and the closer plays at the window end.
  const openBumperId = (slotMetadata.openBumperId as string | null) ?? null
  const closeBumperId = (slotMetadata.closeBumperId as string | null) ?? null
  const isYoutubeSlot = activeSlot.contentSource === 'youtube'
  const hasWindowBumpers = isYoutubeSlot && !inAdBreak && Boolean(openBumperId || closeBumperId)

  const youtubeSelection = await selectYoutubeSelection({
    stationId,
    now,
    preferInfomercialAds,
    slotStartMs,
    contentEndMs,
    fillerDurationMins: activeSlot.fillerDuration ?? 0,
    inAdBreak,
    currentAdBreak,
    inFiller,
    fallbackId: inAdBreak ? (fillerPools.ads ?? null) : (activeSlot.fillerId ?? fillerPools.music ?? null),
    // Between-show padding filler should use ad-like categories only.
    fillerCategories: inFiller ? ['ads', 'music', 'infomercial'] : fillerCategories,
    windowSegment: hasWindowBumpers ? { startMs: slotStartMs, durationMins: activeSlot.durationMins } : null,
    openBumperId: hasWindowBumpers ? openBumperId : null,
    closeBumperId: hasWindowBumpers ? closeBumperId : null,
    hintCtx,
  })

  // ── Up Next: the next scheduled programme after the current instant ──────
  const upNextSlot = allSlots.find((slot) => {
    if (slot.startTime.getTime() <= now) return false
    if (slot.contentSource !== 'plex') return false
    return true
  }) ?? null
  const upNext: UpNextInfo | null = upNextSlot
    ? await (async () => {
        const meta = fromJsonObject<Record<string, unknown>>(upNextSlot.metadata) ?? {}
        const media = upNextSlot.contentId
          ? await prisma.mediaItem.findUnique({
              where: { plexKey: upNextSlot.contentId },
              select: { thumbPath: true },
            }).catch(() => null)
          : null
        const anniversary = Number(meta.anniversaryYears)
        return {
          title: String(meta.title ?? upNextSlot.showTitle ?? 'Programme'),
          showTitle: upNextSlot.showTitle,
          seasonNumber: upNextSlot.seasonNumber,
          episodeNumber: upNextSlot.episodeNumber,
          startsAtMs: upNextSlot.startTime.getTime(),
          thumbPath: media?.thumbPath ?? null,
          premiere: Boolean(meta.premiere),
          anniversaryYears: Number.isFinite(anniversary) && anniversary > 0 ? anniversary : null,
        }
      })()
    : null

  // ── Start offset into the content ────────────────────────────────────────
  // Subtract total ad-break time that has already elapsed
  let totalAdMsElapsed = 0
  if (!inFiller && !inAdBreak) {
    for (const ab of adBreaksAbsolute) {
      if (ab.endsAtMs <= now) {
        totalAdMsElapsed += ab.durationMins * 60_000
      } else if (ab.startsAtMs <= now) {
        // We're past the start but not yet at the end (shouldn't happen due to inAdBreak check)
        totalAdMsElapsed += now - ab.startsAtMs
      }
    }
  }

  const startOffsetMs = inFiller
    ? now - contentEndMs                          // Offset into filler
    : inAdBreak
      ? 0                                          // Ads play from start
      : Math.max(0, elapsedMs - totalAdMsElapsed) // Offset into main content

  const youtubeStartOffsetMs = youtubeSelection?.startOffsetMs ?? startOffsetMs

  // ── Upcoming ad breaks (for client pre-planning) ─────────────────────────
  const upcomingAdBreaks = adBreaksAbsolute
    .filter((ab) => ab.startsAtMs > now)
    .map((ab) => ({ startsAtMs: ab.startsAtMs, durationMins: ab.durationMins }))

  // ── Next transition ───────────────────────────────────────────────────────
  let nextTransitionMs: number
  if (inAdBreak) {
    nextTransitionMs = currentAdBreak!.endsAtMs
  } else if (upcomingAdBreaks.length) {
    nextTransitionMs = upcomingAdBreaks[0].startsAtMs
  } else {
    nextTransitionMs = slotEndMs
  }

  const activeContentRating =
    inFiller || inAdBreak || activeSlot.contentSource !== 'plex' || !activeSlot.contentId
      ? null
      : (await prisma.mediaItem.findUnique({
          where: { plexKey: activeSlot.contentId },
          select: { ratings: true },
        }))?.ratings ?? null

  return {
    stationId,
    serverTimeMs: now,

    contentSource: inFiller
      ? 'filler'
      : inAdBreak
        ? 'ad'
        : (activeSlot.contentSource as PlaybackState['contentSource']),

    contentId: inFiller
      ? (youtubeSelection?.currentVideoId ?? activeSlot.fillerId ?? fillerPools.music ?? null)
      : inAdBreak
        ? (youtubeSelection?.currentVideoId ?? fillerPools.ads ?? null)
        : hasWindowBumpers
          ? (youtubeSelection?.currentVideoId ?? activeSlot.fillerId ?? fillerPools.music ?? null)
          : activeSlot.contentId,

    title: inFiller || inAdBreak ? null : (slotMetadata.title as string ?? activeSlot.showTitle ?? null),
    showTitle:     activeSlot.showTitle,
    seasonNumber:  activeSlot.seasonNumber,
    episodeNumber: activeSlot.episodeNumber,
    contentRating: inFiller || inAdBreak ? null : activeContentRating,

    startOffsetMs: inAdBreak || inFiller || hasWindowBumpers ? youtubeStartOffsetMs : startOffsetMs,
    slotStartMs,
    slotEndMs,

    inAdBreak,
    adFillerId:   inAdBreak ? (fillerPools.ads ?? null) : null,
    adBreakEndsMs,
    youtubeQueue:  youtubeSelection?.queue ?? null,

    nextTransitionMs,
    upcomingAdBreaks,

    inFiller,
    fillerStartMs: inFiller ? contentEndMs : null,
    fillerId:      activeSlot.fillerId ?? fillerPools.music ?? null,

    openBumperId,
    closeBumperId,
    offlineGraphicUrl: null,
    channelType: 'standard',
    channelConfig: null,
    upNext,
    newsLive: String(slotMetadata.reason ?? '') === 'news_live_window' && !inFiller,
  }
}

// ─── Non-standard channel types ──────────────────────────────────────────────
// Weather / guide / web / stream / loop channels do not use the schedule at
// all — they derive their entire state from the station's rules JSON.

function buildChannelTypeState(params: {
  offline: PlaybackState
  channelType: string
  stationRules: Record<string, unknown>
  now: number
}): PlaybackState | null {
  const { offline, channelType, stationRules, now } = params
  // These channels have no slot boundaries; poll again in a minute.
  const base: PlaybackState = {
    ...offline,
    slotStartMs: now,
    slotEndMs: now + 60 * 60_000,
    nextTransitionMs: now + 60_000,
    channelType,
  }

  if (channelType === 'weather') {
    const cfg = (stationRules.weather ?? {}) as Record<string, unknown>
    return {
      ...base,
      contentSource: 'weather',
      title: 'Weather',
      channelConfig: {
        latitude: Number(cfg.latitude ?? NaN),
        longitude: Number(cfg.longitude ?? NaN),
        locationName: String(cfg.locationName ?? ''),
        musicVideoId: String(cfg.musicVideoId ?? '').trim() || null,
      },
    }
  }

  if (channelType === 'guide') {
    const cfg = (stationRules.guide ?? {}) as Record<string, unknown>
    return {
      ...base,
      contentSource: 'guide',
      title: 'Programme Guide',
      channelConfig: {
        promoVideoId: String(cfg.promoVideoId ?? '').trim() || null,
        musicVideoId: String(cfg.musicVideoId ?? '').trim() || null,
      },
    }
  }

  if (channelType === 'web') {
    const cfg = (stationRules.web ?? {}) as Record<string, unknown>
    const url = String(cfg.url ?? '').trim()
    if (!url || !/^https?:\/\//i.test(url)) return null
    return {
      ...base,
      contentSource: 'web',
      title: String(cfg.title ?? 'Web Channel'),
      channelConfig: { url },
    }
  }

  if (channelType === 'stream') {
    const cfg = (stationRules.stream ?? {}) as Record<string, unknown>
    const url = String(cfg.url ?? '').trim()
    if (!url || !/^https?:\/\//i.test(url)) return null
    return {
      ...base,
      contentSource: 'stream',
      contentId: url,
      title: String(cfg.title ?? 'Live Stream'),
      channelConfig: { url },
    }
  }

  if (channelType === 'loop') {
    const cfg = (stationRules.loop ?? {}) as Record<string, unknown>
    const contentId = String(cfg.contentId ?? '').trim()
    if (!contentId) return null
    return {
      ...base,
      contentSource: 'filler',
      contentId,
      fillerId: contentId,
      inFiller: true,
      fillerStartMs: now,
      youtubeQueue: [contentId],
      title: String(cfg.title ?? 'Loop'),
      nextTransitionMs: now + 30 * 60_000,
      channelConfig: { contentId },
    }
  }

  return null
}

async function selectYoutubeSelection(params: {
  stationId: string
  now: number
  preferInfomercialAds: boolean
  slotStartMs: number
  contentEndMs: number
  fillerDurationMins: number
  inAdBreak: boolean
  currentAdBreak: { startsAtMs: number; endsAtMs: number; durationMins: number } | undefined
  inFiller: boolean
  fallbackId: string | null
  fillerCategories?: string[]
  windowSegment?: { startMs: number; durationMins: number } | null
  openBumperId?: string | null
  closeBumperId?: string | null
  hintCtx?: { minutesOfDay: number; month: number; day: number } | null
}): Promise<YoutubeSelection | null> {
  const { stationId, now, preferInfomercialAds, slotStartMs, contentEndMs, fillerDurationMins, inAdBreak, currentAdBreak, inFiller, fallbackId, fillerCategories = ['ads', 'music', 'infomercial'], windowSegment = null, openBumperId = null, closeBumperId = null, hintCtx = null } = params
  if (windowSegment) {
    const windowEndMs = windowSegment.startMs + windowSegment.durationMins * 60_000
    // Bumpers and window queues are strictly scoped to the window itself.
    if (now >= windowEndMs) {
      if (!fallbackId) return null
      return { currentVideoId: fallbackId, queue: [fallbackId], startOffsetMs: 0 }
    }
  }

  const segmentStartMs = inAdBreak
    ? (currentAdBreak?.startsAtMs ?? slotStartMs)
    : windowSegment
      ? windowSegment.startMs
      : contentEndMs
  const segmentDurationMins = inAdBreak
    ? (currentAdBreak?.durationMins ?? 0)
    : windowSegment
      ? windowSegment.durationMins
      : fillerDurationMins

  if (segmentDurationMins <= 0) return null

  const seed = `${stationId}:${slotStartMs}:${segmentStartMs}:${inAdBreak ? 'ad' : (inFiller || windowSegment) ? 'filler' : 'youtube'}`
  const selectorCategories = inAdBreak
    ? (preferInfomercialAds ? ['infomercial', 'ads'] : ['ads'])
    : fillerCategories

  const candidatesRaw = await prisma.youtubeContent.findMany({
    where: {
      category: { in: selectorCategories },
      OR: [
        { station: null },
        { station: stationId },
      ],
    },
    select: {
      videoId: true,
      title: true,
      durationMins: true,
      category: true,
      station: true,
      dayParts: true,
      dateRange: true,
      exclusive: true,
    },
    orderBy: [
      { station: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  // Apply day-part / date-range availability hints (exclusive-wins semantics).
  const candidates = hintCtx ? filterPoolByHints(candidatesRaw, hintCtx) : candidatesRaw

  const inBreakCandidates = inAdBreak && preferInfomercialAds
    ? (() => {
        const infomercialCandidates = candidates.filter((candidate) => candidate.category === 'infomercial')
        if (infomercialCandidates.length) return infomercialCandidates
        return candidates.filter((candidate) => candidate.category === 'ads')
      })()
    : candidates

  const scopedCandidates = preferStationScopedItems(inBreakCandidates.filter(hasVideoId), stationId)
  const seeded = seededShuffle(scopedCandidates, seed)

  // Reserve time at both window edges for opening/closing idents. The playback
  // cursor determines which item is current, so tuning in mid-slot naturally
  // skips the opener while still allowing the closer at the window end.
  const BUMPER_MINS = 1
  const elapsedMs = Math.max(0, now - segmentStartMs)
  const elapsedMins = elapsedMs / 60_000
  const wantOpen = !inAdBreak && Boolean(openBumperId)
  const wantClose = !inAdBreak && Boolean(closeBumperId)
  const reservedMins = (wantOpen ? BUMPER_MINS : 0) + (wantClose ? BUMPER_MINS : 0)
  const middleTargetMins = Math.max(0, segmentDurationMins - reservedMins)

  const middle: YoutubePoolItem[] = []
  let totalMins = 0
  if (middleTargetMins >= 1) {
    for (const item of seeded) {
      middle.push(item)
      totalMins += Math.max(1, item.durationMins ?? 3)
      if (totalMins >= middleTargetMins) break
    }
  }

  const selected: YoutubePoolItem[] = []
  if (wantOpen) selected.push({ videoId: String(openBumperId), title: 'Opening', durationMins: BUMPER_MINS, category: 'bumper', station: stationId })
  selected.push(...middle)
  if (wantClose) selected.push({ videoId: String(closeBumperId), title: 'Closing', durationMins: BUMPER_MINS, category: 'bumper', station: stationId })

  if (!selected.length) {
    if (!fallbackId) return null
    return { currentVideoId: fallbackId, queue: [fallbackId], startOffsetMs: Math.max(0, now - segmentStartMs) }
  }

  let currentIndex = 0
  let cursorMins = 0

  for (let i = 0; i < selected.length; i++) {
    const itemDuration = Math.max(1, selected[i].durationMins ?? 3)
    if (elapsedMins < cursorMins + itemDuration) {
      currentIndex = i
      break
    }
    cursorMins += itemDuration
    currentIndex = Math.min(i + 1, selected.length - 1)
  }

  const current = selected[currentIndex] ?? selected[selected.length - 1]
  const currentOffsetMs = Math.max(0, Math.floor((elapsedMins - cursorMins) * 60_000))
  const queue = selected.slice(currentIndex).map((item) => item.videoId)

  return {
    currentVideoId: current.videoId,
    queue,
    startOffsetMs: currentOffsetMs,
  }
}
