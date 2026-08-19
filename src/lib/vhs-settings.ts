import { prisma } from './db'
import { toJson, fromJson } from './json'
import { DEFAULT_VHS_SETTINGS, type VHSSettings, type OffAirStyle } from './vhs-defaults'

export const NUMBER_VHS_KEYS = [
  'scanlines',
  'noise',
  'chromaticAberration',
  'vignette',
  'crtCurvature',
  'flicker',
  'ghosting',
  'trackingNoise',
  'horizontalJitter',
] as const

export const BOOLEAN_VHS_KEYS = [
  'debugOverlayEnabled',
  'syncWobbleJumpsEnabled',
  'overscanSoftnessEnabled',
  'fourByThreeEnabled',
  'compositeArtifactsEnabled',
  'phosphorBloomEnabled',
  'shadowMaskEnabled',
  'tvSpeakerAudioEnabled',
  'channelChangeSoundEnabled',
] as const

const OFF_AIR_STYLES: OffAirStyle[] = ['testcard', 'bluescreen', 'static']
const OFF_AIR_STYLE_KEY = 'offAirStyle'
const VHS_KEYS = [...NUMBER_VHS_KEYS, ...BOOLEAN_VHS_KEYS, OFF_AIR_STYLE_KEY] as const

export async function getGlobalVHSSettings(): Promise<VHSSettings> {
  const rows = await prisma.adminPreference.findMany({
    where: {
      settingKey: { in: [...VHS_KEYS] },
      OR: [{ stationId: null }, { stationId: '__global__' }],
    },
  })

  const settings: VHSSettings = { ...DEFAULT_VHS_SETTINGS }
  const sorted = [...rows].sort((a, b) => {
    if (a.stationId === '__global__' && b.stationId !== '__global__') return 1
    if (a.stationId !== '__global__' && b.stationId === '__global__') return -1
    return 0
  })
  for (const row of sorted) {
    if (NUMBER_VHS_KEYS.includes(row.settingKey as typeof NUMBER_VHS_KEYS[number])) {
      const numericKey = row.settingKey as typeof NUMBER_VHS_KEYS[number]
      settings[numericKey] = fromJson<number>(row.settingValue, DEFAULT_VHS_SETTINGS[numericKey])
    }
    if (BOOLEAN_VHS_KEYS.includes(row.settingKey as typeof BOOLEAN_VHS_KEYS[number])) {
      const booleanKey = row.settingKey as typeof BOOLEAN_VHS_KEYS[number]
      settings[booleanKey] = fromJson<boolean>(row.settingValue, DEFAULT_VHS_SETTINGS[booleanKey])
    }
    if (row.settingKey === OFF_AIR_STYLE_KEY) {
      const value = fromJson<string>(row.settingValue, DEFAULT_VHS_SETTINGS.offAirStyle)
      if (OFF_AIR_STYLES.includes(value as OffAirStyle)) settings.offAirStyle = value as OffAirStyle
    }
  }

  return settings
}

export async function saveGlobalVHSSettings(patch: Partial<Record<(typeof VHS_KEYS)[number], number | boolean>>): Promise<void> {
  const writes: Array<Promise<unknown>> = []

  for (const key of NUMBER_VHS_KEYS) {
    const raw = patch[key]
    if (typeof raw !== 'number') continue
    const value = Math.min(1, Math.max(0, raw))
    writes.push(
      prisma.adminPreference.upsert({
        where: {
          stationId_settingKey: {
            stationId: '__global__',
            settingKey: key,
          },
        },
        update: { settingValue: toJson(value) },
        create: { stationId: '__global__', settingKey: key, settingValue: toJson(value) },
      }),
    )
  }

  for (const key of BOOLEAN_VHS_KEYS) {
    const raw = patch[key]
    if (typeof raw !== 'boolean') continue
    writes.push(
      prisma.adminPreference.upsert({
        where: {
          stationId_settingKey: {
            stationId: '__global__',
            settingKey: key,
          },
        },
        update: { settingValue: toJson(raw) },
        create: { stationId: '__global__', settingKey: key, settingValue: toJson(raw) },
      }),
    )
  }

  const offAirRaw = (patch as Record<string, unknown>)[OFF_AIR_STYLE_KEY]
  if (typeof offAirRaw === 'string' && OFF_AIR_STYLES.includes(offAirRaw as OffAirStyle)) {
    writes.push(
      prisma.adminPreference.upsert({
        where: {
          stationId_settingKey: {
            stationId: '__global__',
            settingKey: OFF_AIR_STYLE_KEY,
          },
        },
        update: { settingValue: toJson(offAirRaw) },
        create: { stationId: '__global__', settingKey: OFF_AIR_STYLE_KEY, settingValue: toJson(offAirRaw) },
      }),
    )
  }

  if (writes.length) await Promise.all(writes)
}
