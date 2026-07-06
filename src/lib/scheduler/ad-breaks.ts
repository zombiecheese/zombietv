// Ad break construction — pure scheduler core, unit-testable.
//
// Content ad breaks honour the slot's break strategy:
//   'standard' — interval breaks, each snapped to the nearest Plex chapter
//                boundary (±6 min) so cuts land on natural scene breaks
//   'center'   — one break in the middle (intermission feel for movies)
//   'end'      — no mid-roll breaks; ads only run between programmes

export type BreakStrategy = 'standard' | 'center' | 'end'

export interface AdBreakSpec {
  offsetMins: number
  durationMins: number
}

export interface ChapterMarker {
  title?: string
  startOffsetMs: number
}

export interface IntroCreditsMarker {
  type: string        // 'intro' | 'credits' | 'commercial'
  startMs: number
  endMs: number
}

export interface BreakableItem {
  durationMins: number
  chapters?: ChapterMarker[]
  markers?: IntroCreditsMarker[]
}

export const CHAPTER_SNAP_TOLERANCE_MINS = 6

// Natural cut points for a piece of content: chapter starts, plus the end of
// the intro and the start of the credits (Plex Pass markers). These are where
// mid-roll breaks feel like real broadcast cuts.
export function cutPointCandidates(item: BreakableItem): ChapterMarker[] {
  const out: ChapterMarker[] = [...(item.chapters ?? [])]
  for (const m of item.markers ?? []) {
    const type = String(m.type ?? '').toLowerCase()
    if (type === 'intro' && Number.isFinite(m.endMs)) out.push({ title: 'intro-end', startOffsetMs: m.endMs })
    if (type === 'credits' && Number.isFinite(m.startMs)) out.push({ title: 'credits-start', startOffsetMs: m.startMs })
    if (type === 'commercial' && Number.isFinite(m.startMs)) out.push({ title: 'commercial', startOffsetMs: m.startMs })
  }
  return out
}

// Effective runtime: when a credits marker sits near the end of the content,
// there is no reason to broadcast minutes of credits before the next slot —
// trim to one minute past the credits start. Conservative: only trims when the
// credits marker is in the final 15% of the runtime and saves ≥ 3 minutes.
export function effectiveRuntimeMins(item: BreakableItem): number {
  const duration = Math.max(0, Math.round(item.durationMins))
  const creditsCandidates = (item.markers ?? [])
    .filter((m) => String(m.type ?? '').toLowerCase() === 'credits' && Number.isFinite(m.startMs))
    .map((m) => m.startMs / 60_000)
    .filter((mins) => mins >= duration * 0.85)
    .sort((a, b) => a - b)
  if (!creditsCandidates.length) return duration

  const trimmed = Math.ceil(creditsCandidates[0]) + 1
  if (trimmed >= duration - 2) return duration // saves < 3 min — not worth it
  return Math.max(1, trimmed)
}

// Plain interval breaks (used for filler slots and as the 'standard' baseline).
export function buildAdBreaks(
  contentDurationMins: number,
  intervalMins: number,
  enabled: boolean,
): AdBreakSpec[] {
  if (!enabled || intervalMins <= 0) return []
  const breaks: AdBreakSpec[] = []
  for (let offset = intervalMins; offset < contentDurationMins; offset += intervalMins) {
    breaks.push({ offsetMins: offset, durationMins: 3 }) // 3-min ad pod
  }
  return breaks
}

export function snapOffsetToChapter(
  offsetMins: number,
  chapters: ChapterMarker[] | undefined,
  durationMins: number,
): number {
  if (!chapters?.length) return offsetMins
  let best = offsetMins
  let bestDiff = Number.POSITIVE_INFINITY
  for (const ch of chapters) {
    const chMins = Number(ch.startOffsetMs) / 60_000
    if (!Number.isFinite(chMins)) continue
    // Never snap into the very start or the closing credits zone.
    if (chMins < 2 || chMins > durationMins - 2) continue
    const diff = Math.abs(chMins - offsetMins)
    if (diff < bestDiff) {
      bestDiff = diff
      best = Math.round(chMins)
    }
  }
  return bestDiff <= CHAPTER_SNAP_TOLERANCE_MINS ? best : offsetMins
}

export function buildContentAdBreaks(
  item: BreakableItem,
  intervalMins: number,
  enabled: boolean,
  strategy?: BreakStrategy,
): AdBreakSpec[] {
  if (!enabled) return []
  const strat = strategy ?? 'standard'
  if (strat === 'end') return []

  const candidates = cutPointCandidates(item)

  if (strat === 'center') {
    if (item.durationMins < 20) return []
    const mid = snapOffsetToChapter(Math.floor(item.durationMins / 2), candidates, item.durationMins)
    return [{ offsetMins: Math.max(1, Math.min(item.durationMins - 1, mid)), durationMins: 3 }]
  }

  const base = buildAdBreaks(item.durationMins, intervalMins, enabled)
  if (!candidates.length || !base.length) return base

  const used = new Set<number>()
  const out: AdBreakSpec[] = []
  for (const ab of base) {
    let snapped = snapOffsetToChapter(ab.offsetMins, candidates, item.durationMins)
    while (used.has(snapped)) snapped += 1
    if (snapped >= item.durationMins - 1) continue
    used.add(snapped)
    out.push({ offsetMins: snapped, durationMins: ab.durationMins })
  }
  return out.sort((a, b) => a.offsetMins - b.offsetMins)
}
