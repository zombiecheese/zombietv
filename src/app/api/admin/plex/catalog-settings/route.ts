import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import {
  getCatalogAutoSyncMaxAgeHours,
  getCatalogLibraryClassifications,
  getCatalogSelectedLibraryKeys,
  saveCatalogLibraryClassifications,
  saveCatalogAutoSyncMaxAgeHours,
  saveCatalogSelectedLibraryKeys,
} from '@/lib/plex-catalog'
import {
  getPlexAuthRedirectBaseUrl,
  isValidPlexAuthRedirectBaseUrl,
  savePlexAuthRedirectBaseUrl,
} from '@/lib/plex-auth-redirect'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const autoSyncMaxAgeHours = await getCatalogAutoSyncMaxAgeHours()
  const selectedLibraryKeys = await getCatalogSelectedLibraryKeys()
  const libraryClassifications = await getCatalogLibraryClassifications()
  const authRedirectBaseUrl = await getPlexAuthRedirectBaseUrl()
  return NextResponse.json({ autoSyncMaxAgeHours, selectedLibraryKeys, libraryClassifications, authRedirectBaseUrl })
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req)
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => ({}))
  const hasAutoSync = body?.autoSyncMaxAgeHours !== undefined
  const hasLibraries = body?.selectedLibraryKeys !== undefined
  const hasLibraryClasses = body?.libraryClassifications !== undefined
  const hasAuthRedirectBaseUrl = body?.authRedirectBaseUrl !== undefined

  if (!hasAutoSync && !hasLibraries && !hasLibraryClasses && !hasAuthRedirectBaseUrl) {
    return NextResponse.json({ error: 'No settings provided.' }, { status: 400 })
  }

  let autoSyncMaxAgeHours = await getCatalogAutoSyncMaxAgeHours()
  if (hasAutoSync) {
    const parsed = Number(body?.autoSyncMaxAgeHours)
    if (!Number.isFinite(parsed)) {
      return NextResponse.json({ error: 'autoSyncMaxAgeHours must be a number.' }, { status: 400 })
    }
    autoSyncMaxAgeHours = await saveCatalogAutoSyncMaxAgeHours(parsed)
  }

  let selectedLibraryKeys = await getCatalogSelectedLibraryKeys()
  if (hasLibraries) {
    if (!Array.isArray(body?.selectedLibraryKeys)) {
      return NextResponse.json({ error: 'selectedLibraryKeys must be an array.' }, { status: 400 })
    }
    selectedLibraryKeys = await saveCatalogSelectedLibraryKeys(body.selectedLibraryKeys)
  }

  let libraryClassifications = await getCatalogLibraryClassifications()
  if (hasLibraryClasses) {
    if (!body?.libraryClassifications || typeof body.libraryClassifications !== 'object' || Array.isArray(body.libraryClassifications)) {
      return NextResponse.json({ error: 'libraryClassifications must be an object.' }, { status: 400 })
    }
    libraryClassifications = await saveCatalogLibraryClassifications(body.libraryClassifications)
  }

  let authRedirectBaseUrl = await getPlexAuthRedirectBaseUrl()
  if (hasAuthRedirectBaseUrl) {
    if (!isValidPlexAuthRedirectBaseUrl(body?.authRedirectBaseUrl)) {
      return NextResponse.json({ error: 'authRedirectBaseUrl must be an absolute http(s) URL.' }, { status: 400 })
    }
    authRedirectBaseUrl = await savePlexAuthRedirectBaseUrl(body?.authRedirectBaseUrl)
  }

  return NextResponse.json({ ok: true, autoSyncMaxAgeHours, selectedLibraryKeys, libraryClassifications, authRedirectBaseUrl })
}
