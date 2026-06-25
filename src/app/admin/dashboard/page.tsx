'use client'

import { useEffect, useState } from 'react'

import AdminShell from '@/components/admin/AdminShell'

// IANA zones for the timezone picker datalist. Prefer the runtime-supported list
// when available, falling back to a representative set for older environments.
const TIMEZONE_OPTIONS: string[] = (() => {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (typeof supported === 'function') return supported('timeZone')
  } catch { /* ignore */ }
  return [
    'UTC',
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Adelaide', 'Australia/Perth',
    'Pacific/Auckland', 'Europe/London', 'Europe/Paris', 'Europe/Berlin',
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Asia/Tokyo', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Kolkata', 'Asia/Dubai',
  ]
})()

export default function AdminDashboard() {
  const [mounted, setMounted] = useState(false)
  const [isCatalogSyncing, setIsCatalogSyncing] = useState(false)
  const [isSavingCatalogSettings, setIsSavingCatalogSettings] = useState(false)
  const [isSavingLibrarySelection, setIsSavingLibrarySelection] = useState(false)
  const [isSavingAuthRedirect, setIsSavingAuthRedirect] = useState(false)
  const [isClearingCatalog, setIsClearingCatalog] = useState(false)
  const [selectedLibraryKeys, setSelectedLibraryKeys] = useState<string[]>([])
  const [selectedLibraryClasses, setSelectedLibraryClasses] = useState<Record<string, string>>({})
  const [plexStatus, setPlexStatus] = useState<{
    connected: boolean
    hasToken: boolean
    hasServer: boolean
    plexServerName: string | null
    plexServerUrl: string | null
    authRedirectBaseUrl?: string | null
    catalogSyncRunning?: boolean
    catalog?: {
      itemCount: number
      lastSyncAt: string | null
      autoSyncMaxAgeHours: number
      yearBounds?: { minYear: number | null; maxYear: number | null }
      selectedLibraryKeys?: string[]
      libraryClassifications?: Record<string, string>
      libraryClassOptions?: string[]
      libraries?: Array<{ key: string; title: string; type: 'movie' | 'show' }>
      lastSummary?: {
        movies: number
        shows: number
        episodes: number
        upserts: number
        startedAt: string
        finishedAt: string
      } | null
      syncProgress?: {
        isRunning: boolean
        phase: 'idle' | 'movies' | 'shows' | 'episodes' | 'finalizing' | 'error'
        movies: number
        shows: number
        episodes: number
        upserts: number
        startedAt: string | null
        updatedAt: string
        error: string | null
      }
    }
  } | null>(null)
  const [plexMsg, setPlexMsg] = useState('')
  const [catalogAutoSyncHours, setCatalogAutoSyncHours] = useState('72')
  const [authRedirectBaseUrl, setAuthRedirectBaseUrl] = useState('')
  const [appName, setAppName] = useState('')
  const [appTagline, setAppTagline] = useState('')
  const [isSavingAppName, setIsSavingAppName] = useState(false)
  const [appNameMsg, setAppNameMsg] = useState('')
  const [schedulerHorizonDays, setSchedulerHorizonDays]       = useState('7')
  const [schedulerIntervalHours, setSchedulerIntervalHours]   = useState('24')
  const [schedulerYearMin, setSchedulerYearMin]               = useState('')
  const [schedulerYearMax, setSchedulerYearMax]               = useState('')
  const [catalogYearBounds, setCatalogYearBounds]             = useState<{ minYear: number | null; maxYear: number | null } | null>(null)
  const [isSavingSchedulerSettings, setIsSavingSchedulerSettings] = useState(false)
  const [schedulerSettingsMsg, setSchedulerSettingsMsg]       = useState('')
  const [broadcastTimezone, setBroadcastTimezone]             = useState('')
  const [isSavingTimezone, setIsSavingTimezone]               = useState(false)
  const [timezoneMsg, setTimezoneMsg]                         = useState('')
  const [schedulerStatus, setSchedulerStatus] = useState<{
    isRunning: boolean
    status?: {
      isRunning: boolean
      phase: string
      horizonDays: number
      stationId: string | null
      forceRegenerate: boolean
      stationsTotal: number
      stationsProcessed: number
      daysTotal: number
      daysProcessed: number
      daysCreated: number
      startedAt: string | null
      updatedAt: string
      finishedAt: string | null
      lastError: string | null
      note: string | null
    }
    coverage: {
      scheduledDays: number
      targetDays: number
      progressPercent: number
      byStation: Array<{ stationId: string; days: number }>
    }
    checkedAt: string
  } | null>(null)

  const refreshSchedulerStatus = async () => {
    const data = await fetch('/api/scheduler/run').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (data) {
      setSchedulerStatus(data)
    }
  }

  const saveAppName = async () => {
    setIsSavingAppName(true)
    const r = await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName, appTagline }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingAppName(false)
    if (!r.ok) { setAppNameMsg(data?.error || 'Could not save app name.'); return }
    setAppName(data.appName ?? appName)
    if (typeof data.appTagline === 'string') setAppTagline(data.appTagline)
    setAppNameMsg(`Site identity saved: ${data.appName}`)
  }

  const saveSchedulerSettings = async () => {
    const horizonDays     = Number(schedulerHorizonDays)
    const intervalHours   = Number(schedulerIntervalHours)
    if (!Number.isFinite(horizonDays) || !Number.isFinite(intervalHours)) {
      setSchedulerSettingsMsg('Both fields must be numbers.')
      return
    }

    const parseYear = (value: string): number | null => {
      const trimmed = value.trim()
      if (!trimmed) return null
      const parsed = Number(trimmed)
      return Number.isFinite(parsed) ? Math.round(parsed) : null
    }
    let yearMin = parseYear(schedulerYearMin)
    let yearMax = parseYear(schedulerYearMax)
    if ((schedulerYearMin.trim() && yearMin == null) || (schedulerYearMax.trim() && yearMax == null)) {
      setSchedulerSettingsMsg('Year range values must be valid years.')
      return
    }
    if (catalogYearBounds?.minYear != null) {
      if (yearMin != null) yearMin = Math.max(catalogYearBounds.minYear, yearMin)
      if (yearMax != null) yearMax = Math.max(catalogYearBounds.minYear, yearMax)
    }
    if (catalogYearBounds?.maxYear != null) {
      if (yearMin != null) yearMin = Math.min(catalogYearBounds.maxYear, yearMin)
      if (yearMax != null) yearMax = Math.min(catalogYearBounds.maxYear, yearMax)
    }
    if (yearMin != null && yearMax != null && yearMin > yearMax) {
      const tmp = yearMin
      yearMin = yearMax
      yearMax = tmp
    }

    setIsSavingSchedulerSettings(true)
    const r = await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schedulerHorizonDays: horizonDays,
        schedulerIntervalHours: intervalHours,
        schedulerYearMin: yearMin,
        schedulerYearMax: yearMax,
      }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingSchedulerSettings(false)
    if (!r.ok) { setSchedulerSettingsMsg(data?.error || 'Could not save scheduler settings.'); return }
    setSchedulerHorizonDays(String(data.schedulerHorizonDays ?? horizonDays))
    setSchedulerIntervalHours(String(data.schedulerIntervalHours ?? intervalHours))
    setSchedulerYearMin(data.schedulerYearMin != null ? String(data.schedulerYearMin) : '')
    setSchedulerYearMax(data.schedulerYearMax != null ? String(data.schedulerYearMax) : '')
    setSchedulerSettingsMsg('Scheduler settings saved. Next auto-run rescheduled.')
  }

  const saveBroadcastTimezone = async () => {
    setIsSavingTimezone(true)
    const r = await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ broadcastTimezone }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingTimezone(false)
    if (!r.ok) { setTimezoneMsg(data?.error || 'Could not save timezone.'); return }
    setBroadcastTimezone(data.broadcastTimezone ?? broadcastTimezone)
    setTimezoneMsg(`Broadcast timezone saved: ${data.broadcastTimezone}. Regenerate schedules so existing days adopt the new zone.`)
  }

  const refreshPlexStatus = async () => {
    const data = await fetch('/api/admin/plex').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!data) return
    setPlexStatus(data)
    setIsCatalogSyncing(!!data.catalogSyncRunning)
    if (data.catalog?.yearBounds && typeof data.catalog.yearBounds === 'object') {
      const minYear = Number((data.catalog.yearBounds as { minYear?: unknown }).minYear)
      const maxYear = Number((data.catalog.yearBounds as { maxYear?: unknown }).maxYear)
      setCatalogYearBounds({
        minYear: Number.isFinite(minYear) ? minYear : null,
        maxYear: Number.isFinite(maxYear) ? maxYear : null,
      })
    } else {
      setCatalogYearBounds(null)
    }
    if (typeof data.catalog?.autoSyncMaxAgeHours === 'number') {
      setCatalogAutoSyncHours(String(data.catalog.autoSyncMaxAgeHours))
    }
    setAuthRedirectBaseUrl(String(data.authRedirectBaseUrl ?? ''))
    if (Array.isArray(data.catalog?.selectedLibraryKeys)) {
      setSelectedLibraryKeys(data.catalog.selectedLibraryKeys.map((key: unknown) => String(key)))
    }
    if (data.catalog?.libraryClassifications && typeof data.catalog.libraryClassifications === 'object') {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(data.catalog.libraryClassifications as Record<string, unknown>)) {
        next[String(k)] = String(v)
      }
      setSelectedLibraryClasses(next)
    }
  }

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    fetch('/api/app-settings').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.appName) setAppName(d.appName); if (typeof d?.appTagline === 'string') setAppTagline(d.appTagline) }).catch(() => {})
    refreshPlexStatus().catch(() => {})
    refreshSchedulerStatus().catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/app-settings').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return
      if (d.schedulerHorizonDays  != null) setSchedulerHorizonDays(String(d.schedulerHorizonDays))
      if (d.schedulerIntervalHours != null) setSchedulerIntervalHours(String(d.schedulerIntervalHours))
      setSchedulerYearMin(d.schedulerYearMin != null ? String(d.schedulerYearMin) : '')
      setSchedulerYearMax(d.schedulerYearMax != null ? String(d.schedulerYearMax) : '')
      if (typeof d.broadcastTimezone === 'string') setBroadcastTimezone(d.broadcastTimezone)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!mounted) return
    const plex = new URLSearchParams(window.location.search).get('plex')
    if (!plex) return
    if (plex === 'connected') {
      setPlexMsg('Plex connected for admin scheduling.')
      refreshPlexStatus().catch(() => {})
      return
    }
    if (plex === 'pin_not_authed') setPlexMsg('Plex auth not completed yet. Please approve in Plex and retry.')
    else if (plex === 'missing_pin') setPlexMsg('Missing Plex PIN for callback.')
    else if (plex === 'forbidden') setPlexMsg('Admin session required to connect Plex.')
    else setPlexMsg('Plex connect failed. Please try again.')
  }, [mounted])

  const connectPlex = async () => {
    const r = await fetch('/api/admin/plex', { method: 'POST' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok || !data.authUrl) {
      setPlexMsg('Could not initiate Plex connect flow.')
      return
    }
    window.location.href = data.authUrl
  }

  const syncCatalog = async () => {
    const r = await fetch('/api/admin/plex/catalog-sync', { method: 'POST' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      setPlexMsg(data?.error || 'Could not start catalog sync.')
      return
    }

    if (data.started) setPlexMsg('Catalog sync started. Progress will update below.')
    else setPlexMsg('Catalog sync already running.')

    await refreshPlexStatus()
  }

  const saveCatalogSettings = async () => {
    const parsed = Number(catalogAutoSyncHours)
    if (!Number.isFinite(parsed)) {
      setPlexMsg('Catalog auto-resync threshold must be a number of hours.')
      return
    }

    setIsSavingCatalogSettings(true)
    const r = await fetch('/api/admin/plex/catalog-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoSyncMaxAgeHours: parsed }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingCatalogSettings(false)

    if (!r.ok) {
      setPlexMsg(data?.error || 'Could not save catalog auto-resync setting.')
      return
    }

    setCatalogAutoSyncHours(String(data.autoSyncMaxAgeHours))
    setPlexMsg(`Catalog auto-resync threshold saved to ${data.autoSyncMaxAgeHours} hours.`)
    await refreshPlexStatus()
  }

  const saveAuthRedirectBaseUrl = async () => {
    setIsSavingAuthRedirect(true)
    const r = await fetch('/api/admin/plex/catalog-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authRedirectBaseUrl }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingAuthRedirect(false)

    if (!r.ok) {
      setPlexMsg(data?.error || 'Could not save Plex auth redirect URL.')
      return
    }

    setAuthRedirectBaseUrl(String(data.authRedirectBaseUrl ?? ''))
    setPlexMsg(data.authRedirectBaseUrl
      ? `Plex auth redirect URL saved: ${data.authRedirectBaseUrl}`
      : 'Plex auth redirect URL cleared. Default request origin will be used.')
    await refreshPlexStatus()
  }

  const saveLibrarySelection = async () => {
    setIsSavingLibrarySelection(true)
    const r = await fetch('/api/admin/plex/catalog-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selectedLibraryKeys,
        libraryClassifications: selectedLibraryClasses,
      }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingLibrarySelection(false)

    if (!r.ok) {
      setPlexMsg(data?.error || 'Could not save Plex library selection.')
      return
    }

    setPlexMsg('Plex library selection saved. Run a catalog sync to apply it to scheduling.')
    await refreshPlexStatus()
  }

  const toggleLibrary = (libraryKey: string, libraryType: 'movie' | 'show') => {
    setSelectedLibraryKeys((prev) => (
      prev.includes(libraryKey)
        ? prev.filter((key) => key !== libraryKey)
        : [...prev, libraryKey]
    ))

    setSelectedLibraryClasses((prev) => {
      if (prev[libraryKey]) return prev
      return { ...prev, [libraryKey]: libraryType === 'movie' ? 'movies' : 'tv_shows' }
    })
  }

  const updateLibraryClass = (libraryKey: string, classification: string) => {
    setSelectedLibraryClasses((prev) => ({
      ...prev,
      [libraryKey]: classification,
    }))
  }

  const clearCatalog = async () => {
    if (!window.confirm('Clear the synced Plex catalog and show progress data? This does not remove schedules.')) return
    setIsClearingCatalog(true)
    const r = await fetch('/api/admin/plex/catalog-clear', { method: 'POST' })
    const data = await r.json().catch(() => ({}))
    setIsClearingCatalog(false)
    if (!r.ok) {
      setPlexMsg(data?.error || 'Could not clear catalog.')
      return
    }
    setPlexMsg(`Catalog cleared. Removed ${data.removedCatalog ?? 0} catalog items and ${data.removedShowProgress ?? 0} show-progress rows.`)
    await refreshPlexStatus()
  }

  useEffect(() => {
    if (!isCatalogSyncing && !schedulerStatus?.status?.isRunning) return
    const id = setInterval(() => {
      refreshPlexStatus().catch(() => {})
      refreshSchedulerStatus().catch(() => {})
    }, 3000)
    return () => clearInterval(id)
  }, [isCatalogSyncing, schedulerStatus?.status?.isRunning])

  const hasCatalogYearBounds = catalogYearBounds?.minYear != null && catalogYearBounds?.maxYear != null
  const minCatalogYear = hasCatalogYearBounds ? Number(catalogYearBounds.minYear) : 1980
  const maxCatalogYear = hasCatalogYearBounds ? Number(catalogYearBounds.maxYear) : 2020
  const selectedMinYear = (() => {
    const parsed = Number(schedulerYearMin)
    if (!Number.isFinite(parsed)) return minCatalogYear
    return Math.min(Math.max(parsed, minCatalogYear), maxCatalogYear)
  })()
  const selectedMaxYear = (() => {
    const parsed = Number(schedulerYearMax)
    if (!Number.isFinite(parsed)) return maxCatalogYear
    return Math.min(Math.max(parsed, minCatalogYear), maxCatalogYear)
  })()
  const yearSpan = Math.max(1, maxCatalogYear - minCatalogYear)
  const selectedMinPct = ((selectedMinYear - minCatalogYear) / yearSpan) * 100
  const selectedMaxPct = ((selectedMaxYear - minCatalogYear) / yearSpan) * 100
  const tickYears = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(minCatalogYear + yearSpan * ratio))

  return (
    <AdminShell>
      <h2 style={h2}>Overview</h2>
      <p style={{ color: '#4a7fb5', fontSize: '0.8rem', margin: '0 0 24px' }}>
        Select a section below to manage the broadcast system.
      </p>

      {/* ── Site Identity ──────────────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>🏷️</div>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e8f0fe', marginBottom: 6 }}>Site Identity</div>
        <div style={{ fontSize: '0.72rem', color: '#4a7fb5', lineHeight: 1.5, marginBottom: 10 }}>
          The app name is shown in the browser title, admin sidebar, admin login, and viewer sign-in screen.
          The tagline is the descriptive suffix after the app name in the browser tab title (e.g. &ldquo;Zombie TV — 1990s Broadcast Simulator&rdquo;). Leave it blank to show only the app name.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0', minWidth: 260, flex: 1 }}>
            App name
            <input
              type="text"
              maxLength={80}
              placeholder="Zombie TV"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              style={numberInput}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0', minWidth: 260, flex: 1 }}>
            Browser title tagline
            <input
              type="text"
              maxLength={120}
              placeholder="1990s Broadcast Simulator"
              value={appTagline}
              onChange={(e) => setAppTagline(e.target.value)}
              style={numberInput}
            />
          </label>
          <button onClick={saveAppName} style={secondaryBtn} disabled={isSavingAppName}>
            {isSavingAppName ? 'SAVING...' : 'SAVE NAME'}
          </button>
        </div>
        {appNameMsg && <div style={{ fontSize: '0.72rem', color: '#4caf50', marginTop: 4 }}>{appNameMsg}</div>}
      </div>

      {/* ── Scheduler Settings ──────────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>⏱️</div>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e8f0fe', marginBottom: 6 }}>Scheduler Settings</div>
        <div style={{ fontSize: '0.72rem', color: '#4a7fb5', lineHeight: 1.5, marginBottom: 10 }}>
          Schedule horizon: how many days ahead to generate. Auto-run interval: how often the scheduler checks for missing days.
          Year range: constrain auto-scheduled Plex movies and shows to releases within the selected bounds.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0' }}>
            Horizon (days)
            <input type="number" min={1} max={60} step={1} value={schedulerHorizonDays}
              onChange={(e) => setSchedulerHorizonDays(e.target.value)} style={numberInput} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0' }}>
            Auto-run interval (hours)
            <input type="number" min={1} max={168} step={1} value={schedulerIntervalHours}
              onChange={(e) => setSchedulerIntervalHours(e.target.value)} style={numberInput} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0', minWidth: 220 }}>
            Start year
            <input
              type="number"
              min={minCatalogYear}
              max={selectedMaxYear}
              step={1}
              value={schedulerYearMin}
              onChange={(e) => setSchedulerYearMin(e.target.value)}
              style={numberInput}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0', minWidth: 220 }}>
            End year
            <input
              type="number"
              min={selectedMinYear}
              max={maxCatalogYear}
              step={1}
              value={schedulerYearMax}
              onChange={(e) => setSchedulerYearMax(e.target.value)}
              style={numberInput}
            />
          </label>
          <button onClick={saveSchedulerSettings} style={secondaryBtn} disabled={isSavingSchedulerSettings}>
            {isSavingSchedulerSettings ? 'SAVING...' : 'SAVE SCHEDULER'}
          </button>
        </div>
        <div style={{ marginBottom: 8, padding: '10px 12px', border: '1px solid #1e3a5f', backgroundColor: '#07111f' }}>
          <div style={{ color: '#a8c4e0', fontSize: '0.7rem', marginBottom: 6 }}>
            {hasCatalogYearBounds
              ? `Catalog year bounds: ${minCatalogYear} - ${maxCatalogYear}`
              : 'Catalog year bounds unavailable. Sync Plex catalog to enable range limits.'}
          </div>
          <div style={{ position: 'relative', padding: '36px 6px 18px' }}>
            <div style={{
              position: 'absolute',
              left: 6,
              right: 6,
              top: 44,
              height: 18,
              borderRadius: 999,
              border: '1px solid #1e3a5f',
              backgroundColor: '#d8d8d8',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22)',
            }} />
            <div style={{
              position: 'absolute',
              top: 45,
              left: `calc(${selectedMinPct}% + 6px)`,
              width: `calc(${Math.max(0, selectedMaxPct - selectedMinPct)}% - 1px)`,
              height: 16,
              borderRadius: 999,
              background: 'linear-gradient(180deg, #76b8e8, #4996d0)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.3)',
            }} />
            <input
              className="year-range-slider"
              type="range"
              min={minCatalogYear}
              max={maxCatalogYear}
              step={1}
              value={selectedMinYear}
              onChange={(e) => {
                const next = Number(e.target.value)
                setSchedulerYearMin(String(Math.min(next, selectedMaxYear)))
              }}
              disabled={!hasCatalogYearBounds}
              style={{ zIndex: 3 }}
            />
            <input
              className="year-range-slider"
              type="range"
              min={minCatalogYear}
              max={maxCatalogYear}
              step={1}
              value={selectedMaxYear}
              onChange={(e) => {
                const next = Number(e.target.value)
                setSchedulerYearMax(String(Math.max(next, selectedMinYear)))
              }}
              disabled={!hasCatalogYearBounds}
              style={{ zIndex: 4 }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: `calc(${selectedMinPct}% + 6px)`,
                transform: 'translateX(-50%)',
                backgroundColor: '#f2f2f2',
                border: '1px solid #cfd4da',
                color: '#3a3a3a',
                fontSize: '0.8rem',
                padding: '4px 10px',
                minWidth: 74,
                textAlign: 'center',
              }}
            >
              {selectedMinYear.toLocaleString()}
            </div>
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: `calc(${selectedMaxPct}% + 6px)`,
                transform: 'translateX(-50%)',
                backgroundColor: '#f2f2f2',
                border: '1px solid #cfd4da',
                color: '#3a3a3a',
                fontSize: '0.8rem',
                padding: '4px 10px',
                minWidth: 74,
                textAlign: 'center',
              }}
            >
              {selectedMaxYear.toLocaleString()}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8ea7c3', fontSize: '0.72rem', marginTop: 2 }}>
            {tickYears.map((year, idx) => (
              <span key={`${year}-${idx}`}>{year.toLocaleString()}</span>
            ))}
          </div>
          <div style={{ color: '#4a7fb5', fontSize: '0.68rem', marginTop: 8 }}>
            Selected: {selectedMinYear.toLocaleString()} - {selectedMaxYear.toLocaleString()}
          </div>
        </div>
        {schedulerSettingsMsg && <div style={{ fontSize: '0.72rem', color: '#4caf50', marginTop: 4 }}>{schedulerSettingsMsg}</div>}
      </div>

      <style jsx global>{`
        .year-range-slider {
          -webkit-appearance: none;
          appearance: none;
          position: absolute;
          left: 6px;
          right: 6px;
          top: 36px;
          width: calc(100% - 12px);
          height: 34px;
          background: transparent;
          pointer-events: none;
          margin: 0;
        }

        .year-range-slider::-webkit-slider-runnable-track {
          height: 18px;
          background: transparent;
        }

        .year-range-slider::-moz-range-track {
          height: 18px;
          background: transparent;
        }

        .year-range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid #31343a;
          background: linear-gradient(180deg, #5b5f66, #3f4349);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
          margin-top: -7px;
          pointer-events: auto;
          cursor: pointer;
        }

        .year-range-slider::-moz-range-thumb {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 1px solid #31343a;
          background: linear-gradient(180deg, #5b5f66, #3f4349);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
          pointer-events: auto;
          cursor: pointer;
        }

        .year-range-slider:disabled::-webkit-slider-thumb {
          opacity: 0.45;
          cursor: not-allowed;
        }

        .year-range-slider:disabled::-moz-range-thumb {
          opacity: 0.45;
          cursor: not-allowed;
        }
      `}</style>

      {/* ── Broadcast Timezone ──────────────────────────────────────────────── */}
      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>🌏</div>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e8f0fe', marginBottom: 6 }}>Broadcast Timezone</div>
        <div style={{ fontSize: '0.72rem', color: '#4a7fb5', lineHeight: 1.5, marginBottom: 10 }}>
          The single timezone all broadcast times are authored and displayed in. Times are stored as UTC and
          aligned to this zone across the schedule editor, the EPG, and live playback — so the guide matches the
          schedule regardless of where the server or a viewer is located. After changing this, click
          &ldquo;Regenerate Schedule&rdquo; so existing days adopt the new zone.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 6 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0', minWidth: 280, flex: 1 }}>
            IANA timezone (e.g. Australia/Sydney)
            <input
              type="text"
              list="timezone-options"
              placeholder="Australia/Sydney"
              value={broadcastTimezone}
              onChange={(e) => setBroadcastTimezone(e.target.value)}
              style={numberInput}
            />
            <datalist id="timezone-options">
              {TIMEZONE_OPTIONS.map((tz) => <option key={tz} value={tz} />)}
            </datalist>
          </label>
          <button onClick={saveBroadcastTimezone} style={secondaryBtn} disabled={isSavingTimezone || !broadcastTimezone.trim()}>
            {isSavingTimezone ? 'SAVING...' : 'SAVE TIMEZONE'}
          </button>
        </div>
        {timezoneMsg && <div style={{ fontSize: '0.72rem', color: '#4caf50', marginTop: 4 }}>{timezoneMsg}</div>}
      </div>

      {/* ── Scheduler Status ──────────────────────────────────────────────── */}
      {schedulerStatus && (
        <div style={{ ...card, marginBottom: 18 }}>
          <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>⚙️</div>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e8f0fe', marginBottom: 6 }}>Regeneration Status</div>
          <div style={{ fontSize: '0.72rem', color: '#4a7fb5', lineHeight: 1.5, marginBottom: 10 }}>
            Live status of the scheduler. Visit the Schedule Editor for manual triggers and detailed logs.
          </div>
          {schedulerStatus.status ? (
            <div style={{ fontSize: '0.72rem', color: '#a8c4e0', lineHeight: 1.6, marginBottom: 10 }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ color: schedulerStatus.status.isRunning ? '#ffb74d' : '#4caf50', fontWeight: 700 }}>
                  {schedulerStatus.status.isRunning ? 'RUNNING' : 'IDLE'}
                </span>
                {schedulerStatus.status.phase ? (
                  <span> · Phase: {schedulerStatus.status.phase}</span>
                ) : null}
              </div>
              <div>
                Scope: {schedulerStatus.status.stationId ? schedulerStatus.status.stationId.toUpperCase() : 'ALL'} · Horizon: {schedulerStatus.status.horizonDays} days · Mode: {schedulerStatus.status.forceRegenerate ? 'regeneration' : 'generation'}
              </div>
              <div style={{ marginTop: 6 }}>
                Stations: {schedulerStatus.status.stationsProcessed}/{schedulerStatus.status.stationsTotal} · Days: {schedulerStatus.status.daysProcessed}/{schedulerStatus.status.daysTotal} · Created: {schedulerStatus.status.daysCreated}
              </div>
              {schedulerStatus.status.note ? (
                <div style={{ marginTop: 6 }}>{schedulerStatus.status.note}</div>
              ) : null}
              {schedulerStatus.status.lastError ? (
                <div style={{ marginTop: 6, color: '#ff8a80' }}>Error: {schedulerStatus.status.lastError}</div>
              ) : null}
              {schedulerStatus.status.startedAt ? (
                <div style={{ marginTop: 6, color: '#4a7fb5', fontSize: '0.68rem' }}>
                  Started: {new Date(schedulerStatus.status.startedAt).toLocaleString()}
                </div>
              ) : null}
              {schedulerStatus.status.finishedAt ? (
                <div style={{ color: '#4a7fb5', fontSize: '0.68rem' }}>
                  Finished: {new Date(schedulerStatus.status.finishedAt).toLocaleString()}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={{ fontSize: '0.72rem', color: '#4a7fb5' }}>No recent scheduler runs.</div>
          )}
          <div style={{ fontSize: '0.68rem', color: '#4a7fb5', marginTop: 8 }}>
            Updated {new Date(schedulerStatus.checkedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}
          </div>
        </div>
      )}

      <div style={{ ...card, marginBottom: 18 }}>
        <div style={{ fontSize: '1.2rem', marginBottom: 8 }}>🔐</div>
        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e8f0fe', marginBottom: 6 }}>Connect Plex (Admin)</div>
        <div style={{ fontSize: '0.72rem', color: '#4a7fb5', lineHeight: 1.5, marginBottom: 10 }}>
          Scheduler reads Plex credentials from admin preferences. Connect once here to enable schedule generation.
        </div>
        <div style={{ fontSize: '0.72rem', color: plexStatus?.connected ? '#4caf50' : '#ffb74d', marginBottom: 10 }}>
            {plexStatus?.connected
              ? `Connected${plexStatus.plexServerName ? `: ${plexStatus.plexServerName}` : plexStatus.plexServerUrl ? `: ${plexStatus.plexServerUrl}` : ''}`
              : `Not connected${plexStatus ? ` (token: ${plexStatus.hasToken ? 'yes' : 'no'}, server: ${plexStatus.hasServer ? 'yes' : 'no'})` : ''}`}
        </div>
          {plexStatus?.connected && plexStatus.plexServerUrl && (
            <div style={{ fontSize: '0.72rem', color: '#4a7fb5', marginBottom: 10 }}>
              {`Plex server URL: ${plexStatus.plexServerUrl}`}
            </div>
          )}
        {plexStatus?.catalog && (
          <div style={{ fontSize: '0.72rem', color: '#a8c4e0', lineHeight: 1.5, marginBottom: 10 }}>
            {`Catalog items: ${plexStatus.catalog.itemCount}`}
            <br />
            {`Last sync: ${plexStatus.catalog.lastSyncAt ? new Date(plexStatus.catalog.lastSyncAt).toLocaleString() : 'never'}`}
            <br />
            {`Auto-resync threshold: ${plexStatus.catalog.autoSyncMaxAgeHours} hours`}
            {plexStatus.catalog.syncProgress ? (
              <>
                <br />
                {`Sync status: ${plexStatus.catalog.syncProgress.isRunning ? 'running' : plexStatus.catalog.syncProgress.phase}`}
                <br />
                {`Progress: movies ${plexStatus.catalog.syncProgress.movies}, shows ${plexStatus.catalog.syncProgress.shows}, episodes ${plexStatus.catalog.syncProgress.episodes}, upserts ${plexStatus.catalog.syncProgress.upserts}`}
                {plexStatus.catalog.syncProgress.error ? (
                  <>
                    <br />
                    {`Last error: ${plexStatus.catalog.syncProgress.error}`}
                  </>
                ) : null}
              </>
            ) : null}
            {plexStatus.catalog.lastSummary ? (
              <>
                <br />
                {`Last sync summary: movies ${plexStatus.catalog.lastSummary.movies}, shows ${plexStatus.catalog.lastSummary.shows}, episodes ${plexStatus.catalog.lastSummary.episodes}`}
              </>
            ) : null}
          </div>
        )}

        {plexStatus?.catalog?.libraries?.length ? (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: '0.72rem', color: '#a8c4e0', marginBottom: 6 }}>
              Plex libraries used for scheduling sync
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 6 }}>
              {plexStatus.catalog.libraries.map((library) => {
                const checked = selectedLibraryKeys.includes(library.key)
                const classOptions = (plexStatus.catalog?.libraryClassOptions ?? ['tv_shows', 'movies', 'animation', 'fitness']).map(String)
                const selectedClass = selectedLibraryClasses[library.key] ?? (library.type === 'movie' ? 'movies' : 'tv_shows')
                return (
                  <label key={library.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.72rem', color: '#e8f0fe' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleLibrary(library.key, library.type)}
                      style={{ accentColor: '#ff6600' }}
                    />
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>{library.title} <span style={{ color: '#4a7fb5' }}>({library.type})</span></span>
                      {checked ? (
                        <select
                          value={selectedClass}
                          onChange={(e) => updateLibraryClass(library.key, e.target.value)}
                          style={{
                            backgroundColor: '#07111f',
                            color: '#e8f0fe',
                            border: '1px solid #1e3a5f',
                            padding: '4px 6px',
                            fontSize: '0.7rem',
                            width: 150,
                          }}
                        >
                          {classOptions.map((opt) => (
                            <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                      ) : null}
                    </span>
                  </label>
                )
              })}
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={saveLibrarySelection} style={secondaryBtn} disabled={isSavingLibrarySelection}>
                {isSavingLibrarySelection ? 'SAVING LIBRARIES...' : 'SAVE LIBRARY SELECTION'}
              </button>
            </div>
          </div>
        ) : null}

        {plexMsg && <div style={{ fontSize: '0.72rem', color: '#a8c4e0', marginBottom: 10 }}>{plexMsg}</div>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0' }}>
            Catalog auto-resync age (hours)
            <input
              type="number"
              min={1}
              max={720}
              step={1}
              value={catalogAutoSyncHours}
              onChange={(e) => setCatalogAutoSyncHours(e.target.value)}
              style={numberInput}
            />
          </label>
          <button onClick={saveCatalogSettings} style={secondaryBtn} disabled={isSavingCatalogSettings}>
            {isSavingCatalogSettings ? 'SAVING...' : 'SAVE AUTO-RESYNC'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.72rem', color: '#a8c4e0', minWidth: 340, flex: 1 }}>
            Plex auth redirect base URL (optional)
            <input
              type="url"
              placeholder="https://your-hosted-site.example"
              value={authRedirectBaseUrl}
              onChange={(e) => setAuthRedirectBaseUrl(e.target.value)}
              style={numberInput}
            />
          </label>
          <button onClick={saveAuthRedirectBaseUrl} style={secondaryBtn} disabled={isSavingAuthRedirect}>
            {isSavingAuthRedirect ? 'SAVING...' : 'SAVE REDIRECT URL'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={connectPlex} style={connectBtn}>CONNECT PLEX (ADMIN)</button>
          <button onClick={syncCatalog} style={connectBtn} disabled={isCatalogSyncing}>
            {isCatalogSyncing ? 'SYNCING CATALOG...' : 'SYNC PLEX CATALOG'}
          </button>
          <button onClick={clearCatalog} style={dangerBtn} disabled={isClearingCatalog || isCatalogSyncing}>
            {isClearingCatalog ? 'CLEARING CATALOG...' : 'CLEAR SYNCED CATALOG'}
          </button>
        </div>
      </div>

    </AdminShell>
  )
}

const h2: React.CSSProperties = { margin: '0 0 8px', color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const card: React.CSSProperties = {
  display: 'block', textDecoration: 'none',
  backgroundColor: '#0a1628', border: '1px solid #1e3a5f',
  padding: '20px', transition: 'border-color 0.15s',
}
const connectBtn: React.CSSProperties = {
  backgroundColor: '#ff6600',
  color: '#fff',
  border: 'none',
  padding: '8px 14px',
  cursor: 'pointer',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
}
const secondaryBtn: React.CSSProperties = {
  ...connectBtn,
  backgroundColor: '#1e3a5f',
}
const numberInput: React.CSSProperties = {
  backgroundColor: '#07111f',
  color: '#e8f0fe',
  border: '1px solid #1e3a5f',
  padding: '8px 10px',
  minWidth: 140,
}
const dangerBtn: React.CSSProperties = {
  ...connectBtn,
  backgroundColor: '#8b1a1a',
}
