// Real-Time Playback Engine
// Given a stationId + the current UTC timestamp, returns exactly what
// that station is broadcasting right now, how far through it we are,
// and when the next transition happens.
//
// This is the server's single source of truth for all clients.
// Clients call GET /api/now/[stationId] and receive a PlaybackState.

import { prisma }                         from './db'
import { fromJsonArray, fromJsonObject }  from './json'
import { createHash }                    from 'crypto'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdBreakDef {
  offsetMins:  number
  durationMins: number
}

export interface PlaybackState {
  stationId:       string
  serverTimeMs:    number          // Server's current UTC epoch ms — clients use this to sync

  // What is on air right now
  contentSource:   'plex' | 'youtube' | 'filler' | 'ad' | 'offline'
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
  activeBumperId?: string | null
  bumperPhase?: 'open' | 'close' | null
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

// ─── Main function ────────────────────────────────────────────────────────────

export async function getPlaybackState(stationId: string, nowMs?: number): Promise<PlaybackState> {
  const now = nowMs ?? Date.now()
  const nowDate = new Date(now)

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
  }

  // ── Find the active schedule for today ──────────────────────────────────
  // Schedules are stored by local calendar day, not UTC date-only midnight.
  // Match the admin schedule route so after-midnight local playback still
  // resolves the active schedule row created for that broadcast day.
  const todayMidnight = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
    0,
    0,
    0,
    0,
  )
  const yesterdayMidnight = new Date(todayMidnight)
  yesterdayMidnight.setDate(yesterdayMidnight.getDate() - 1)
  const tomorrowMidnight = new Date(todayMidnight)
  tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1)

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
        include: {
          mediaItems: {
            orderBy: { orderIndex: 'asc' },
            include: {
              mediaItem: {
                select: { ratings: true },
              },
            },
          },
        },
      },
    },
    orderBy: { date: 'asc' },
  })

  if (!schedules.length) return offline

  const allSlots = schedules
    .flatMap((schedule: { slots: typeof schedules[0]["slots"] }) => schedule.slots)
    .sort((a: typeof schedules[0]["slots"][0], b: typeof schedules[0]["slots"][0]) => a.startTime.getTime() - b.startTime.getTime())

  if (!allSlots.length) return offline

  // ── Find the active slot ────────────────────────────────────────────────
  const activeSlot = allSlots.reduce<typeof allSlots[number] | null>((latest: typeof allSlots[number] | null, slot: typeof allSlots[number]) => {
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

  if (!activeSlot) return offline

  const slotStartMs    = activeSlot.startTime.getTime()
  const elapsedMs      = now - slotStartMs

  // ── Calculate ad breaks (ads add to wall-clock runtime) ───────────────────
  const adBreakDefs: AdBreakDef[] = fromJsonArray<AdBreakDef>(activeSlot.adBreaks)

  // Pre-fetch the ad-eligible pool once so each ad break can extend its end to
  // the completion of the last ad video — ads always play to the end before the
  // main programme resumes.
  const adPool = adBreakDefs.length
    ? (await prisma.youtubeContent.findMany({
        where: {
          category: { in: ['ads', 'filler', 'music'] },
          OR: [{ station: null }, { station: stationId }],
        },
        select: { videoId: true, durationMins: true },
      })).filter((item: any): item is { videoId: string; durationMins: number | null } => Boolean(item.videoId))
    : []

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
      const durMs = Math.max(1, (item as typeof adPool[0]).durationMins ?? 3) * 60_000
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
  const station = await prisma.station.findUnique({
    where: { id: stationId },
    select: { fillerPools: true },
  })
  const fillerPools = fromJsonObject<Record<string, string | null>>(station?.fillerPools)

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

  let fillerCategories: string[] = ['ads', 'filler', 'music']
  
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

  const youtubeSelection = await selectYoutubeSelection({
    stationId,
    now,
    slotStartMs,
    contentEndMs,
    fillerDurationMins: activeSlot.fillerDuration ?? 0,
    inAdBreak,
    currentAdBreak,
    inFiller,
    fallbackId: inAdBreak ? (fillerPools.ads ?? fillerPools.music ?? null) : (activeSlot.fillerId ?? fillerPools.music ?? null),
    fillerCategories,
  })

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

  const activeContentRating = activeSlot.mediaItems[0]?.mediaItem?.ratings ?? null

  // ── Extract bumper metadata from slot ──────────────────────────────────────
  const activeFillerWindow = resolveActiveFillerWindow(slotMetadata, nowDate)
  const openBumperId =
    activeFillerWindow?.openBumperId ??
    ((slotMetadata.openBumperId as string | null) ?? null)
  const closeBumperId =
    activeFillerWindow?.closeBumperId ??
    ((slotMetadata.closeBumperId as string | null) ?? null)
  const bumper = selectWindowBumper(
    now,
    activeFillerWindow?.windowStartMs ?? slotStartMs,
    activeFillerWindow?.windowEndMs ?? slotEndMs,
    openBumperId,
    closeBumperId,
    inFiller,
  )

  return {
    stationId,
    serverTimeMs: now,

    contentSource: inFiller
      ? 'filler'
      : inAdBreak
        ? 'ad'
        : (activeSlot.contentSource as PlaybackState['contentSource']),

    contentId: inFiller
      ? (bumper.activeBumperId ?? youtubeSelection?.currentVideoId ?? activeSlot.fillerId ?? fillerPools.music ?? null)
      : inAdBreak
        ? (youtubeSelection?.currentVideoId ?? fillerPools.ads ?? fillerPools.music ?? null)
        : activeSlot.contentId,

    title: inFiller || inAdBreak ? null : (slotMetadata.title as string ?? activeSlot.showTitle ?? null),
    showTitle:     activeSlot.showTitle,
    seasonNumber:  activeSlot.seasonNumber,
    episodeNumber: activeSlot.episodeNumber,
    contentRating: inFiller || inAdBreak ? null : activeContentRating,

    startOffsetMs: inAdBreak || inFiller
      ? (bumper.activeBumperId ? 0 : youtubeStartOffsetMs)
      : startOffsetMs,
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
    activeBumperId: bumper.activeBumperId,
    bumperPhase: bumper.bumperPhase,
    offlineGraphicUrl: null,
  }
}

  function selectWindowBumper(
  nowMs: number,
  slotStartMs: number,
  slotEndMs: number,
    openBumperId: string | null,
    closeBumperId: string | null,
  inFiller: boolean,
  ): { activeBumperId: string | null; bumperPhase: 'open' | 'close' | null } {
  if (!inFiller) {
    return { activeBumperId: null, bumperPhase: null }
  }

  function parseClockMinutes(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.min(24 * 60, Math.floor(value)))
    }
    if (typeof value !== 'string') return null
    const m = value.trim().match(/^(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const hours = Number(m[1])
    const mins = Number(m[2])
    if (Number.isNaN(hours) || Number.isNaN(mins) || hours < 0 || hours > 24 || mins < 0 || mins > 59) {
      return null
    }
    return Math.max(0, Math.min(24 * 60, hours * 60 + mins))
  }

  function resolveActiveFillerWindow(
    slotMetadata: Record<string, unknown>,
    nowDate: Date,
  ): {
    openBumperId: string | null
    closeBumperId: string | null
    windowStartMs: number
    windowEndMs: number
  } | null {
    if (!Array.isArray(slotMetadata.fillerWindows)) return null

    const nowMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()
    const localMidnight = new Date(
      nowDate.getFullYear(),
      nowDate.getMonth(),
      nowDate.getDate(),
      0,
      0,
      0,
      0,
    ).getTime()

    for (const rawWindow of slotMetadata.fillerWindows as Array<Record<string, unknown>>) {
      const start = parseClockMinutes(rawWindow.start ?? rawWindow.startTime ?? rawWindow.startMins)
      const end = parseClockMinutes(rawWindow.end ?? rawWindow.endTime ?? rawWindow.endMins)
      if (start === null || end === null || start === end) continue

      const wrapsMidnight = end < start
      const inWindow = wrapsMidnight
        ? nowMinutes >= start || nowMinutes < end
        : nowMinutes >= start && nowMinutes < end
      if (!inWindow) continue

      let windowStartMs = localMidnight + start * 60_000
      let windowEndMs = localMidnight + end * 60_000
      if (wrapsMidnight) {
        if (nowMinutes < end) {
          windowStartMs -= 24 * 60 * 60_000
        } else {
          windowEndMs += 24 * 60 * 60_000
        }
      }

      return {
        openBumperId: typeof rawWindow.openVideoId === 'string' ? rawWindow.openVideoId : null,
        closeBumperId: typeof rawWindow.closeVideoId === 'string' ? rawWindow.closeVideoId : null,
        windowStartMs,
        windowEndMs,
      }
    }

    return null
  }

  if (openBumperId && nowMs >= slotStartMs && nowMs < slotStartMs + 60_000) {
      return { activeBumperId: openBumperId, bumperPhase: 'open' }
    }

  if (closeBumperId && nowMs >= Math.max(slotStartMs, slotEndMs - 60_000) && nowMs < slotEndMs) {
      return { activeBumperId: closeBumperId, bumperPhase: 'close' }
    }

    return { activeBumperId: null, bumperPhase: null }
  }
async function selectYoutubeSelection(params: {
  stationId: string
  now: number
  slotStartMs: number
  contentEndMs: number
  fillerDurationMins: number
  inAdBreak: boolean
  currentAdBreak: { startsAtMs: number; endsAtMs: number; durationMins: number } | undefined
  inFiller: boolean
  fallbackId: string | null
  fillerCategories?: string[]
}): Promise<YoutubeSelection | null> {
  const { stationId, now, slotStartMs, contentEndMs, fillerDurationMins, inAdBreak, currentAdBreak, inFiller, fallbackId, fillerCategories = ['ads', 'filler', 'music', 'news'] } = params
  const segmentStartMs = inAdBreak
    ? (currentAdBreak?.startsAtMs ?? slotStartMs)
    : contentEndMs
  const segmentDurationMins = inAdBreak
    ? (currentAdBreak?.durationMins ?? 0)
    : fillerDurationMins

  if (segmentDurationMins <= 0) return null

  const seed = `${stationId}:${slotStartMs}:${segmentStartMs}:${inAdBreak ? 'ad' : inFiller ? 'filler' : 'youtube'}`
  const selectorCategories = inAdBreak
    ? ['ads', 'filler', 'music']
    : fillerCategories

  const candidates = await prisma.youtubeContent.findMany({
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
    },
    orderBy: [
      { station: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  const seeded = seededShuffle(
    candidates.filter((item: any): item is YoutubePoolItem & { videoId: string } => Boolean(item.videoId)),
    seed,
  )

  const selected: YoutubePoolItem[] = []
  let totalMins = 0
  for (const item of seeded) {
    selected.push(item as YoutubePoolItem)
    totalMins += Math.max(1, (item as any).durationMins ?? 3)
    if (totalMins >= segmentDurationMins) break
  }

  if (!selected.length) {
    if (!fallbackId) return null
    return { currentVideoId: fallbackId, queue: [fallbackId], startOffsetMs: Math.max(0, now - segmentStartMs) }
  }

  const elapsedMins = Math.max(0, (now - segmentStartMs) / 60_000)
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

function seededShuffle<T>(items: T[], seed: string): T[] {
  const result = [...items]
  const rand = mulberry32(seedToUInt32(seed))

  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }

  return result
}

function seedToUInt32(seed: string): number {
  const hash = createHash('sha256').update(seed).digest()
  return hash.readUInt32LE(0)
}

function mulberry32(a: number): () => number {
  return () => {
    let t = a += 0x6D2B79F5
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
