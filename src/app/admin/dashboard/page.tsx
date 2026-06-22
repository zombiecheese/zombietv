'use client'

import { useEffect, useState } from 'react'

import AdminShell from '@/components/admin/AdminShell'

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
  const [isSavingAppName, setIsSavingAppName] = useState(false)
  const [appNameMsg, setAppNameMsg] = useState('')
  const [schedulerHorizonDays, setSchedulerHorizonDays]       = useState('7')
  const [schedulerIntervalHours, setSchedulerIntervalHours]   = useState('24')
  const [isSavingSchedulerSettings, setIsSavingSchedulerSettings] = useState(false)
  const [schedulerSettingsMsg, setSchedulerSettingsMsg]       = useState('')
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
      body: JSON.stringify({ appName }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingAppName(false)
    if (!r.ok) { setAppNameMsg(data?.error || 'Could not save app name.'); return }
    setAppName(data.appName ?? appName)
    setAppNameMsg(`App name saved: ${data.appName}`)
  }

  const saveSchedulerSettings = async () => {
    const horizonDays     = Number(schedulerHorizonDays)
    const intervalHours   = Number(schedulerIntervalHours)
    if (!Number.isFinite(horizonDays) || !Number.isFinite(intervalHours)) {
      setSchedulerSettingsMsg('Both fields must be numbers.')
      return
    }
    setIsSavingSchedulerSettings(true)
    const r = await fetch('/api/app-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedulerHorizonDays: horizonDays, schedulerIntervalHours: intervalHours }),
    })
    const data = await r.json().catch(() => ({}))
    setIsSavingSchedulerSettings(false)
    if (!r.ok) { setSchedulerSettingsMsg(data?.error || 'Could not save scheduler settings.'); return }
    setSchedulerHorizonDays(String(data.schedulerHorizonDays ?? horizonDays))
    setSchedulerIntervalHours(String(data.schedulerIntervalHours ?? intervalHours))
    setSchedulerSettingsMsg('Scheduler settings saved. Next auto-run rescheduled.')
  }

  const refreshPlexStatus = async () => {
    const data = await fetch('/api/admin/plex').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!data) return
    setPlexStatus(data)
    setIsCatalogSyncing(!!data.catalogSyncRunning)
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
    fetch('/api/app-settings').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.appName) setAppName(d.appName) }).catch(() => {})
    refreshPlexStatus().catch(() => {})
    refreshSchedulerStatus().catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/app-settings').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return
      if (d.schedulerHorizonDays  != null) setSchedulerHorizonDays(String(d.schedulerHorizonDays))
      if (d.schedulerIntervalHours != null) setSchedulerIntervalHours(String(d.schedulerIntervalHours))
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
          <button onClick={saveSchedulerSettings} style={secondaryBtn} disabled={isSavingSchedulerSettings}>
            {isSavingSchedulerSettings ? 'SAVING...' : 'SAVE SCHEDULER'}
          </button>
        </div>
        {schedulerSettingsMsg && <div style={{ fontSize: '0.72rem', color: '#4caf50', marginTop: 4 }}>{schedulerSettingsMsg}</div>}
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
