import { prisma } from './db'
import { fromJson, toJson } from './json'

const PLEX_AUTH_REDIRECT_BASE_URL_KEY = 'plex_auth_redirect_base_url'

function normalizeToOrigin(value: unknown): string | null {
  const text = String(value ?? '').trim()
  if (!text) return null

  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    return null
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null
  }

  return parsed.origin
}

export async function getPlexAuthRedirectBaseUrl(): Promise<string | null> {
  const pref = await prisma.adminPreference.findFirst({
    where: {
      stationId: null,
      settingKey: PLEX_AUTH_REDIRECT_BASE_URL_KEY,
    },
  })

  const parsed = fromJson<string>(pref?.settingValue, '')
  return normalizeToOrigin(parsed)
}

export async function savePlexAuthRedirectBaseUrl(value: unknown): Promise<string | null> {
  const normalized = normalizeToOrigin(value)
  const existing = await prisma.adminPreference.findFirst({
    where: {
      stationId: null,
      settingKey: PLEX_AUTH_REDIRECT_BASE_URL_KEY,
    },
  })

  if (!normalized) {
    if (existing) {
      await prisma.adminPreference.delete({ where: { id: existing.id } })
    }
    return null
  }

  if (existing) {
    await prisma.adminPreference.update({
      where: { id: existing.id },
      data: { settingValue: toJson(normalized) },
    })
  } else {
    await prisma.adminPreference.create({
      data: {
        stationId: null,
        settingKey: PLEX_AUTH_REDIRECT_BASE_URL_KEY,
        settingValue: toJson(normalized),
      },
    })
  }

  return normalized
}

export function isValidPlexAuthRedirectBaseUrl(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) return true
  return normalizeToOrigin(text) !== null
}