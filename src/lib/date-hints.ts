// Date & day-part hint helpers (FieldStation42-style scheduling hints).
// Pure — safe to import from both the scheduler (server) and admin UI (client).
//
// Supported hint formats (all case-insensitive):
//   "October"                       — a calendar month
//   "Q1" … "Q4"                     — a quarter (Q1 = Jan–Mar)
//   "October 15 - October 31"       — an inclusive date range (may wrap the year,
//                                     e.g. "December 24 - January 2")
//   "friday"                        — a day of the week
//
// Day parts partition the broadcast day for filler/ad eligibility:
//   morning 06:00–10:00 · daytime 10:00–17:00 · prime 17:00–23:00
//   late 23:00–02:00 · overnight 02:00–06:00

export const DAY_PARTS = ['morning', 'daytime', 'prime', 'late', 'overnight'] as const
export type DayPart = typeof DAY_PARTS[number]

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Returns the day part for a wall-clock minutes-of-day value.
export function dayPartForMinutes(minutesOfDay: number): DayPart {
  const m = ((minutesOfDay % 1440) + 1440) % 1440
  if (m >= 6 * 60 && m < 10 * 60) return 'morning'
  if (m >= 10 * 60 && m < 17 * 60) return 'daytime'
  if (m >= 17 * 60 && m < 23 * 60) return 'prime'
  if (m >= 23 * 60 || m < 2 * 60) return 'late'
  return 'overnight'
}

export interface MonthDay {
  month: number // 1–12
  day: number   // 1–31
}

// Parses "October 15" → { month: 10, day: 15 }. Returns null when malformed.
export function parseMonthDay(value: string): MonthDay | null {
  const m = String(value).trim().toLowerCase().match(/^([a-z]+)\s+(\d{1,2})$/)
  if (!m) return null
  const monthIdx = MONTHS.indexOf(m[1])
  const day = Number(m[2])
  if (monthIdx === -1 || day < 1 || day > 31) return null
  return { month: monthIdx + 1, day }
}

// Numeric key for ordering within a year: month*100 + day.
function monthDayKey(md: MonthDay): number {
  return md.month * 100 + md.day
}

// True when the (month, day) falls within an inclusive "Month D - Month D"
// range. Ranges may wrap the year boundary ("December 24 - January 2").
export function dateRangeMatches(rangeStr: string, month: number, day: number): boolean {
  const parts = String(rangeStr).split('-').map((p) => p.trim())
  if (parts.length !== 2) return false
  const start = parseMonthDay(parts[0])
  const end = parseMonthDay(parts[1])
  if (!start || !end) return false

  const key = month * 100 + day
  const startKey = monthDayKey(start)
  const endKey = monthDayKey(end)

  if (startKey <= endKey) return key >= startKey && key <= endKey
  // Wraps the year boundary
  return key >= startKey || key <= endKey
}

// True when `hint` matches the given broadcast date components.
// Accepts month names, quarters (Q1–Q4), date ranges and weekday names.
// An empty/undefined hint always matches.
export function dateHintMatches(
  hint: string | null | undefined,
  parts: { month: number; day: number; weekday: number },
): boolean {
  const raw = String(hint ?? '').trim().toLowerCase()
  if (!raw) return true

  // Quarter
  const quarterMatch = raw.match(/^q([1-4])$/)
  if (quarterMatch) {
    const q = Number(quarterMatch[1])
    return Math.ceil(parts.month / 3) === q
  }

  // Month name
  const monthIdx = MONTHS.indexOf(raw)
  if (monthIdx !== -1) return parts.month === monthIdx + 1

  // Weekday name
  const weekdayIdx = WEEKDAYS.indexOf(raw)
  if (weekdayIdx !== -1) return parts.weekday === weekdayIdx

  // Date range
  if (raw.includes('-')) return dateRangeMatches(raw, parts.month, parts.day)

  return false
}

// Validates a hint string for the admin UI. Empty is valid ("no restriction").
export function isValidDateHint(hint: string): boolean {
  const raw = String(hint ?? '').trim().toLowerCase()
  if (!raw) return true
  if (/^q[1-4]$/.test(raw)) return true
  if (MONTHS.includes(raw)) return true
  if (WEEKDAYS.includes(raw)) return true
  if (raw.includes('-')) {
    const parts = raw.split('-').map((p) => p.trim())
    return parts.length === 2 && !!parseMonthDay(parts[0]) && !!parseMonthDay(parts[1])
  }
  return false
}

// Parses a comma-separated day-part list ("morning,prime") into known tokens.
export function parseDayParts(value: string | null | undefined): DayPart[] {
  if (!value) return []
  return String(value)
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v): v is DayPart => (DAY_PARTS as readonly string[]).includes(v))
}

export interface HintedPoolItem {
  dayParts?: string | null
  dateRange?: string | null
  exclusive?: boolean | null
}

const DAY_MS = 24 * 60 * 60 * 1000

// Circular distance in days between two month/day pairs (year-agnostic).
export function monthDayDistanceDays(aMonth: number, aDay: number, bMonth: number, bDay: number): number {
  const doy = (m: number, d: number) => Math.round((Date.UTC(2001, m - 1, d) - Date.UTC(2001, 0, 1)) / DAY_MS)
  const diff = Math.abs(doy(aMonth, aDay) - doy(bMonth, bDay))
  return Math.min(diff, 365 - diff)
}

// Content whose original air/release date is near the broadcast date gets a
// boost — Christmas episodes surface in December, seasonal specials land in
// season, and anniversaries get their night. airDate is YYYY-MM-DD.
export function seasonalAffinityMultiplier(airDate: string | undefined, month: number, day: number): number {
  if (!airDate || airDate.length < 10) return 1
  const m = Number(airDate.slice(5, 7))
  const d = Number(airDate.slice(8, 10))
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(d) || d < 1) return 1
  const dist = monthDayDistanceDays(m, d, month, day)
  if (dist <= 7) return 1.6
  if (dist <= 21) return 1.2
  return 1
}

// Exact month/day match against the original air date → "aired N years ago tonight".
export function anniversaryYears(airDate: string | undefined, month: number, day: number, currentYear: number): number | null {
  if (!airDate || airDate.length < 10) return null
  const y = Number(airDate.slice(0, 4))
  const m = Number(airDate.slice(5, 7))
  const d = Number(airDate.slice(8, 10))
  if (!Number.isFinite(y) || m !== month || d !== day) return null
  const years = currentYear - y
  return years > 0 ? years : null
}

// FieldStation42-style eligibility filter for filler/ad pools.
//   - Items without hints are always eligible.
//   - Items with dayParts are eligible only during those day parts.
//   - Items with dateRange are eligible only inside that calendar window.
//   - When any *matching hinted* item is marked exclusive, only exclusive
//     matching items remain eligible for that window (themed takeover).
export function filterPoolByHints<T extends HintedPoolItem>(
  items: T[],
  ctx: { minutesOfDay: number; month: number; day: number },
): T[] {
  const currentPart = dayPartForMinutes(ctx.minutesOfDay)

  const matches = (item: T): boolean => {
    const parts = parseDayParts(item.dayParts)
    if (parts.length && !parts.includes(currentPart)) return false
    const range = String(item.dateRange ?? '').trim()
    if (range && !dateRangeMatches(range, ctx.month, ctx.day)) return false
    return true
  }

  const eligible = items.filter(matches)
  const hasHints = (item: T) => Boolean(String(item.dayParts ?? '').trim() || String(item.dateRange ?? '').trim())
  const exclusiveMatching = eligible.filter((item) => item.exclusive && hasHints(item))
  if (exclusiveMatching.length) return exclusiveMatching
  return eligible
}
