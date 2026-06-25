// App-level settings stored in AdminPreference.
// Covers: app name, scheduler horizon days, scheduler interval hours.

import { prisma } from './db'
import { isValidTimeZone } from './time'

const APP_NAME_KEY              = 'app_name'
const APP_TAGLINE_KEY          = 'app_tagline'
const SCHEDULER_HORIZON_KEY     = 'scheduler_horizon_days'
const SCHEDULER_INTERVAL_KEY    = 'scheduler_interval_hours'
const SCHEDULER_YEAR_MIN_KEY    = 'scheduler_year_min'
const SCHEDULER_YEAR_MAX_KEY    = 'scheduler_year_max'
const BROADCAST_TIMEZONE_KEY    = 'broadcast_timezone'

export const DEFAULT_APP_NAME               = 'Zombie TV'
export const DEFAULT_APP_TAGLINE            = '1990s Broadcast Simulator'
export const DEFAULT_SCHEDULER_HORIZON_DAYS  = 7
export const DEFAULT_SCHEDULER_INTERVAL_HOURS = 24
export const DEFAULT_SCHEDULER_YEAR_RANGE: { minYear: number | null; maxYear: number | null } = {
  minYear: null,
  maxYear: null,
}

// Falls back to the container/host TZ, then to an Australian default to match
// the broadcast simulator's intent. Always a valid IANA zone.
export const DEFAULT_BROADCAST_TIMEZONE =
  isValidTimeZone(process.env.TZ) ? (process.env.TZ as string) : 'Australia/Sydney'

export async function getAppName(): Promise<string> {
  try {
    const row = await prisma.adminPreference.findFirst({
      where: { stationId: null, settingKey: APP_NAME_KEY },
    })
    if (!row?.settingValue) return DEFAULT_APP_NAME
    const parsed = JSON.parse(row.settingValue)
    return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : DEFAULT_APP_NAME
  } catch {
    return DEFAULT_APP_NAME
  }
}

export async function saveAppName(name: unknown): Promise<string> {
  const clean = typeof name === 'string' ? name.trim().slice(0, 80) : ''
  const value = clean || DEFAULT_APP_NAME

  const existing = await prisma.adminPreference.findFirst({
    where: { stationId: null, settingKey: APP_NAME_KEY },
  })

  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: JSON.stringify(value) },
    })
  } else {
    await prisma.adminPreference.create({
      data: { stationId: null, settingKey: APP_NAME_KEY, settingValue: JSON.stringify(value) },
    })
  }

  return value
}

// The tagline is the descriptive suffix shown after the app name in the browser
// title (e.g. "Zombie TV — 1990s Broadcast Simulator"). An empty value hides it.
export async function getAppTagline(): Promise<string> {
  try {
    const row = await prisma.adminPreference.findFirst({
      where: { stationId: null, settingKey: APP_TAGLINE_KEY },
    })
    if (row?.settingValue === undefined || row?.settingValue === null) return DEFAULT_APP_TAGLINE
    const parsed = JSON.parse(row.settingValue)
    return typeof parsed === 'string' ? parsed.trim() : DEFAULT_APP_TAGLINE
  } catch {
    return DEFAULT_APP_TAGLINE
  }
}

export async function saveAppTagline(tagline: unknown): Promise<string> {
  const value = typeof tagline === 'string' ? tagline.trim().slice(0, 120) : DEFAULT_APP_TAGLINE

  const existing = await prisma.adminPreference.findFirst({
    where: { stationId: null, settingKey: APP_TAGLINE_KEY },
  })

  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: JSON.stringify(value) },
    })
  } else {
    await prisma.adminPreference.create({
      data: { stationId: null, settingKey: APP_TAGLINE_KEY, settingValue: JSON.stringify(value) },
    })
  }

  return value
}

// ─── Scheduler settings ───────────────────────────────────────────────────────

async function getNumericSetting(key: string, defaultValue: number): Promise<number> {
  try {
    const row = await prisma.adminPreference.findFirst({
      where: { stationId: null, settingKey: key },
    })
    if (!row?.settingValue) return defaultValue
    const parsed = JSON.parse(row.settingValue)
    return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : defaultValue
  } catch {
    return defaultValue
  }
}

async function saveNumericSetting(key: string, value: unknown, min: number, max: number, defaultValue: number): Promise<number> {
  const parsed = Number(value)
  const clean  = Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : defaultValue

  const existing = await prisma.adminPreference.findFirst({
    where: { stationId: null, settingKey: key },
  })
  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: JSON.stringify(clean) },
    })
  } else {
    await prisma.adminPreference.create({
      data: { stationId: null, settingKey: key, settingValue: JSON.stringify(clean) },
    })
  }
  return clean
}

export const getSchedulerHorizonDays   = () => getNumericSetting(SCHEDULER_HORIZON_KEY,  DEFAULT_SCHEDULER_HORIZON_DAYS)
export const getSchedulerIntervalHours = () => getNumericSetting(SCHEDULER_INTERVAL_KEY, DEFAULT_SCHEDULER_INTERVAL_HOURS)

export const saveSchedulerHorizonDays   = (v: unknown) => saveNumericSetting(SCHEDULER_HORIZON_KEY,  v, 1, 60,  DEFAULT_SCHEDULER_HORIZON_DAYS)
export const saveSchedulerIntervalHours = (v: unknown) => saveNumericSetting(SCHEDULER_INTERVAL_KEY, v, 1, 168, DEFAULT_SCHEDULER_INTERVAL_HOURS)

function normalizeOptionalYear(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  // Broad guardrail that safely covers practical film/TV years.
  return Math.max(1888, Math.min(3000, Math.round(parsed)))
}

async function saveOptionalNumericSetting(key: string, value: number | null): Promise<void> {
  const serialized = value == null ? 'null' : JSON.stringify(value)
  const existing = await prisma.adminPreference.findFirst({
    where: { stationId: null, settingKey: key },
  })
  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: serialized },
    })
  } else {
    await prisma.adminPreference.create({
      data: { stationId: null, settingKey: key, settingValue: serialized },
    })
  }
}

export async function getSchedulerYearRange(): Promise<{ minYear: number | null; maxYear: number | null }> {
  try {
    const [minRow, maxRow] = await Promise.all([
      prisma.adminPreference.findFirst({ where: { stationId: null, settingKey: SCHEDULER_YEAR_MIN_KEY } }),
      prisma.adminPreference.findFirst({ where: { stationId: null, settingKey: SCHEDULER_YEAR_MAX_KEY } }),
    ])

    const parsedMin = minRow?.settingValue ? normalizeOptionalYear(JSON.parse(minRow.settingValue)) : null
    const parsedMax = maxRow?.settingValue ? normalizeOptionalYear(JSON.parse(maxRow.settingValue)) : null

    if (parsedMin != null && parsedMax != null && parsedMin > parsedMax) {
      return { minYear: parsedMax, maxYear: parsedMin }
    }

    return {
      minYear: parsedMin,
      maxYear: parsedMax,
    }
  } catch {
    return { ...DEFAULT_SCHEDULER_YEAR_RANGE }
  }
}

export async function saveSchedulerYearRange(range: { minYear?: unknown; maxYear?: unknown }): Promise<{ minYear: number | null; maxYear: number | null }> {
  const parsedMin = normalizeOptionalYear(range?.minYear)
  const parsedMax = normalizeOptionalYear(range?.maxYear)
  const minYear = parsedMin != null && parsedMax != null && parsedMin > parsedMax ? parsedMax : parsedMin
  const maxYear = parsedMin != null && parsedMax != null && parsedMin > parsedMax ? parsedMin : parsedMax

  await Promise.all([
    saveOptionalNumericSetting(SCHEDULER_YEAR_MIN_KEY, minYear),
    saveOptionalNumericSetting(SCHEDULER_YEAR_MAX_KEY, maxYear),
  ])

  return { minYear, maxYear }
}

// ─── Broadcast timezone ───────────────────────────────────────────────────────
// The single IANA timezone all schedule generation, the EPG, the schedule
// editor, and live playback are expressed in. Stored as UTC under the hood; this
// setting only governs how those instants are authored and displayed.

export async function getBroadcastTimezone(): Promise<string> {
  try {
    const row = await prisma.adminPreference.findFirst({
      where: { stationId: null, settingKey: BROADCAST_TIMEZONE_KEY },
    })
    if (!row?.settingValue) return DEFAULT_BROADCAST_TIMEZONE
    const parsed = JSON.parse(row.settingValue)
    return isValidTimeZone(parsed) ? parsed : DEFAULT_BROADCAST_TIMEZONE
  } catch {
    return DEFAULT_BROADCAST_TIMEZONE
  }
}

export async function saveBroadcastTimezone(tz: unknown): Promise<string> {
  if (!isValidTimeZone(tz)) {
    throw new Error('Invalid timezone. Expected an IANA identifier such as "Australia/Sydney".')
  }
  const value = tz

  const existing = await prisma.adminPreference.findFirst({
    where: { stationId: null, settingKey: BROADCAST_TIMEZONE_KEY },
  })
  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: JSON.stringify(value) },
    })
  } else {
    await prisma.adminPreference.create({
      data: { stationId: null, settingKey: BROADCAST_TIMEZONE_KEY, settingValue: JSON.stringify(value) },
    })
  }

  // Apply immediately so subsequent server-side Date math (scheduler generation,
  // playback day resolution) uses the new broadcast zone within this process.
  applyProcessTimezone(value)
  return value
}

// Sets process.env.TZ so the existing local-time Date logic across the scheduler
// and playback engine operates in the broadcast zone. Node honours runtime TZ
// changes for subsequent Date operations.
export function applyProcessTimezone(tz: string): void {
  if (!isValidTimeZone(tz)) return
  process.env.TZ = tz
}

// Loads the persisted broadcast timezone and applies it to the process. Called
// once at server startup before the scheduler runs.
export async function initBroadcastTimezone(): Promise<string> {
  const tz = await getBroadcastTimezone()
  applyProcessTimezone(tz)
  return tz
}
