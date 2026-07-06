// Classification ratings — pure scheduler core, unit-testable.
//
// Australian free-to-air classification zones (the legal max rating by time of
// day). Applied on top of each block's daypart ceiling so content never airs
// out of zone regardless of how a station configures its slots.
//   G      — any time
//   PG     — any time
//   M      — 20:30–05:00, plus 12:00–15:00 on school days (weekdays)
//   MA15+  — 21:00–05:00

import { getZonedParts } from '../time'

export const RATINGS_ORDER = ['G', 'PG', 'M', 'MA15+']

export type Rating = 'G' | 'PG' | 'M' | 'MA15+'

export function ratingAllowed(itemRating: string, ceiling: string): boolean {
  const itemIdx    = RATINGS_ORDER.indexOf(itemRating)
  const ceilingIdx = RATINGS_ORDER.indexOf(ceiling)
  if (itemIdx === -1 || ceilingIdx === -1) return true // unknown rating — allow
  return itemIdx <= ceilingIdx
}

// Returns the stricter (lower) of two classification ratings.
export function stricterRating(a: string, b: string): Rating {
  const ia = RATINGS_ORDER.indexOf(a)
  const ib = RATINGS_ORDER.indexOf(b)
  const idx = Math.min(ia === -1 ? RATINGS_ORDER.length - 1 : ia, ib === -1 ? RATINGS_ORDER.length - 1 : ib)
  return RATINGS_ORDER[idx] as Rating
}

export function classificationCeiling(date: Date, minutesOfDay: number, timezone: string): Rating {
  const parts = getZonedParts(date, timezone)
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay()
  const isWeekday = ![0, 6].includes(weekday)
  if (minutesOfDay >= 21 * 60 || minutesOfDay < 5 * 60) return 'MA15+'
  if (minutesOfDay >= 20 * 60 + 30) return 'M'
  if (isWeekday && minutesOfDay >= 12 * 60 && minutesOfDay < 15 * 60) return 'M'
  return 'PG'
}
