// App-level settings stored in AdminPreference.
// Covers: app name, scheduler horizon days, scheduler interval hours.

import { prisma } from './db'

const APP_NAME_KEY              = 'app_name'
const APP_TAGLINE_KEY          = 'app_tagline'
const SCHEDULER_HORIZON_KEY     = 'scheduler_horizon_days'
const SCHEDULER_INTERVAL_KEY    = 'scheduler_interval_hours'

export const DEFAULT_APP_NAME               = 'Zombie TV'
export const DEFAULT_APP_TAGLINE            = '1990s Broadcast Simulator'
export const DEFAULT_SCHEDULER_HORIZON_DAYS  = 7
export const DEFAULT_SCHEDULER_INTERVAL_HOURS = 24

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
