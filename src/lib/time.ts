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
