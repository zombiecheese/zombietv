// Holiday detection for Australian broadcast overrides
// Easter is calculated dynamically using the Anonymous Gregorian algorithm.

import { prisma } from './db'
import { fromJsonObject, toJson } from './json'
import { getHolidayTagMap, setHolidayTagMap } from './plex-catalog'

export type HolidayName =
  | 'christmas'
  | 'christmas_eve'
  | 'good_friday'
  | 'easter'
  | 'halloween'

export interface HolidaySetting {
  id: string
  name: string
  label: string
  startMonth: number
  startDay: number
  endMonth: number
  endDay: number
  enabled: boolean
}

const HOLIDAY_SETTINGS_KEY = 'holiday_settings'

export const DEFAULT_HOLIDAY_SETTINGS: HolidaySetting[] = [
  { id: 'christmas', name: 'christmas', label: 'Christmas Day', startMonth: 12, startDay: 25, endMonth: 12, endDay: 25, enabled: true },
  { id: 'christmas_eve', name: 'christmas_eve', label: 'Christmas Eve', startMonth: 12, startDay: 24, endMonth: 12, endDay: 24, enabled: true },
  { id: 'good_friday', name: 'good_friday', label: 'Good Friday', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, enabled: true },
  { id: 'easter', name: 'easter', label: 'Easter Sunday', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, enabled: true },
  { id: 'halloween', name: 'halloween', label: 'Halloween', startMonth: 10, startDay: 31, endMonth: 10, endDay: 31, enabled: true },
]

export interface HolidayInfo {
  name: HolidayName
  label: string
  adFreeByDefault: boolean   // Good Friday — some stations go ad-free
}

export const HOLIDAY_INFO: Record<HolidayName, HolidayInfo> = {
  christmas:     { name: 'christmas',     label: 'Christmas Day',  adFreeByDefault: false },
  christmas_eve: { name: 'christmas_eve', label: 'Christmas Eve',  adFreeByDefault: false },
  good_friday:   { name: 'good_friday',   label: 'Good Friday',    adFreeByDefault: true  },
  easter:        { name: 'easter',        label: 'Easter Sunday',  adFreeByDefault: false },
  halloween:     { name: 'halloween',     label: 'Halloween',      adFreeByDefault: false },
}

function normalizeHolidaySetting(setting: Partial<HolidaySetting> & { id?: string; name?: string; label?: string }): HolidaySetting | null {
  const name = String(setting.name ?? '').trim().toLowerCase()
  const label = String(setting.label ?? '').trim()
  const id = String(setting.id ?? name).trim() || name
  const startMonth = Number(setting.startMonth)
  const startDay = Number(setting.startDay)
  const endMonth = Number(setting.endMonth)
  const endDay = Number(setting.endDay)

  if (!name || !label) return null
  if (![startMonth, startDay, endMonth, endDay].every((n) => Number.isFinite(n) && n > 0)) return null
  return {
    id,
    name,
    label,
    startMonth,
    startDay,
    endMonth,
    endDay,
    enabled: setting.enabled !== false,
  }
}

export async function loadHolidaySettings(): Promise<HolidaySetting[]> {
  const row = await prisma.adminPreference.findFirst({
    where: { stationId: null, settingKey: HOLIDAY_SETTINGS_KEY },
  })

  if (!row?.settingValue) return DEFAULT_HOLIDAY_SETTINGS

  const parsed = fromJsonObject<Record<string, unknown>>(row.settingValue)
  const raw = Array.isArray(parsed?.items) ? (parsed.items as Array<Partial<HolidaySetting>>) : []
  const normalized = raw.map((item) => normalizeHolidaySetting(item)).filter((item): item is HolidaySetting => !!item)
  return normalized
}

export async function saveHolidaySettings(settings: HolidaySetting[]): Promise<void> {
  const items = settings.map((item) => normalizeHolidaySetting(item)).filter((item): item is HolidaySetting => !!item)
  const existing = await prisma.adminPreference.findFirst({
    where: { stationId: null, settingKey: HOLIDAY_SETTINGS_KEY },
  })

  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: toJson({ items }) },
    })
    return
  }

  await prisma.adminPreference.create({
    data: { stationId: null, settingKey: HOLIDAY_SETTINGS_KEY, settingValue: toJson({ items }) },
  })
}

export async function renameHolidayReferences(oldName: string, newName: string): Promise<void> {
  const oldKey = String(oldName).trim().toLowerCase()
  const nextKey = String(newName).trim().toLowerCase()
  if (!oldKey || !nextKey || oldKey === nextKey) return

  await prisma.holidayOverride.updateMany({
    where: { holidayName: oldKey },
    data: { holidayName: nextKey },
  })

  const stations = await prisma.station.findMany({ select: { id: true, holidayOverrides: true } })
  for (const station of stations) {
    const overrides = fromJsonObject<Record<string, any>>(station.holidayOverrides)
    if (!(oldKey in overrides)) continue
    overrides[nextKey] = overrides[oldKey]
    delete overrides[oldKey]
    await prisma.station.update({ where: { id: station.id }, data: { holidayOverrides: toJson(overrides) } })
  }

  const tags = await getHolidayTagMap()
  if (tags[oldKey]) {
    tags[nextKey] = Array.from(new Set([...(tags[nextKey] ?? []), ...tags[oldKey]]))
    delete tags[oldKey]
    await setHolidayTagMap(tags)
  }
}

export async function deleteHolidayReferences(name: string): Promise<void> {
  const key = String(name).trim().toLowerCase()
  if (!key) return

  await prisma.holidayOverride.deleteMany({ where: { holidayName: key } })

  const stations = await prisma.station.findMany({ select: { id: true, holidayOverrides: true } })
  for (const station of stations) {
    const overrides = fromJsonObject<Record<string, any>>(station.holidayOverrides)
    if (!(key in overrides)) continue
    delete overrides[key]
    await prisma.station.update({ where: { id: station.id }, data: { holidayOverrides: toJson(overrides) } })
  }

  const tags = await getHolidayTagMap()
  if (tags[key]) {
    delete tags[key]
    await setHolidayTagMap(tags)
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Returns the holiday name for a given date, or null if it's a normal day. */
export function getHolidayForDate(date: Date, settings: HolidaySetting[] = DEFAULT_HOLIDAY_SETTINGS): string | null {
  const month = date.getMonth() + 1 // 1-based
  const day   = date.getDate()
  const year  = date.getFullYear()

  const easter = calculateEaster(year)
  const goodFriday = new Date(easter)
  goodFriday.setDate(easter.getDate() - 2)

  for (const holiday of settings) {
    if (!holiday.enabled) continue
    if (holiday.name === 'good_friday') {
      if (isSameDay(date, goodFriday)) return holiday.name
      continue
    }
    if (holiday.name === 'easter') {
      if (isSameDay(date, easter)) return holiday.name
      continue
    }

    if (matchesMonthDayRange(month, day, holiday.startMonth, holiday.startDay, holiday.endMonth, holiday.endDay)) {
      return holiday.name
    }
  }

  return null
}

// ─── Private ─────────────────────────────────────────────────────────────────

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate()
  )
}

function matchesMonthDayRange(
  month: number,
  day: number,
  startMonth: number,
  startDay: number,
  endMonth: number,
  endDay: number,
): boolean {
  const current = month * 100 + day
  const start = startMonth * 100 + startDay
  const end = endMonth * 100 + endDay
  if (start <= end) return current >= start && current <= end
  return current >= start || current <= end
}

/**
 * Anonymous Gregorian algorithm for Easter Sunday.
 * Returns the Date of Easter Sunday for the given year.
 * Accurate for all years 1583–4099.
 */
function calculateEaster(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1 // 0-based month
  const day   = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month, day)
}
