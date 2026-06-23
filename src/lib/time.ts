// Shared clock parsing used by the scheduler (server) and the Station Rules
// editor (client). Pure — safe to import from either runtime.

// Parses "HH:MM" (24h) to minutes-since-midnight. Returns null for malformed
// input or out-of-range values (e.g. 25:00, 12:60). "24:00" is allowed.
export function parseClockToMinutes(value: string): number | null {
  const m = String(value).trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  if (hh < 0 || hh > 24 || mm < 0 || mm > 59) return null
  if (hh === 24 && mm !== 0) return null
  return hh * 60 + mm
}

// ─── Broadcast timezone helpers ───────────────────────────────────────────────
// All broadcast times are stored as absolute UTC instants. A single configured
// broadcast timezone (IANA, e.g. "Australia/Sydney") governs how those instants
// map to wall-clock times for both schedule generation and display, so the
// guide, schedule editor, and live playback all agree regardless of where the
// server process or the viewer's browser happens to be located.

// Validates an IANA timezone identifier (e.g. "Australia/Sydney", "UTC").
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim()) return false
  try {
    // Throws RangeError for an unknown time zone.
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export interface ZonedParts {
  year:   number   // full year, e.g. 2026
  month:  number   // 1–12
  day:    number   // 1–31
  hour:   number   // 0–23
  minute: number   // 0–59
  second: number   // 0–59
}

// Wall-clock parts of an absolute instant as seen in the given timezone.
export function getZonedParts(date: Date, tz: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12:   false,
    year:  'numeric', month:  '2-digit', day:    '2-digit',
    hour:  '2-digit', minute: '2-digit', second: '2-digit',
  })
  const map: Record<string, number> = {}
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value)
  }
  // Some engines emit hour "24" for midnight; normalize to 0.
  if (map.hour === 24) map.hour = 0
  return {
    year:   map.year,
    month:  map.month,
    day:    map.day,
    hour:   map.hour,
    minute: map.minute,
    second: map.second,
  }
}

// Offset (ms) of the timezone at the given instant, defined so that
// utcInstant + offset == the same wall-clock numbers read as if they were UTC.
function timeZoneOffsetMs(date: Date, tz: string): number {
  const p = getZonedParts(date, tz)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUTC - date.getTime()
}

// Converts a wall-clock time expressed in the given timezone to the absolute
// UTC instant. Two offset iterations converge correctly across DST boundaries.
export function zonedTimeToUtc(
  year:       number,
  monthIndex: number,   // 0–11 (matches Date semantics)
  day:        number,
  hour:       number,
  minute:     number,
  tz:         string,
): Date {
  const guessUTC = Date.UTC(year, monthIndex, day, hour, minute, 0)
  let offset = timeZoneOffsetMs(new Date(guessUTC), tz)
  let result = new Date(guessUTC - offset)
  offset = timeZoneOffsetMs(result, tz)
  result = new Date(guessUTC - offset)
  return result
}

// Formats an absolute instant for display in the configured broadcast timezone.
// When tz is undefined the host's local zone is used (Intl default).
export function formatInTimeZone(
  date:    Date,
  tz:      string | undefined,
  options: Intl.DateTimeFormatOptions,
  locale = 'en-AU',
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).format(date)
}
