'use client'

import { useEffect, useState } from 'react'

import AdminShell from '@/components/admin/AdminShell'
import Link from 'next/link'

const QUICK_LINKS = [
  { href: '/admin/dashboard/schedule', label: 'Schedule Editor',    desc: 'View and override any station’s daily programme grid.',  icon: '📅' },
  { href: '/admin/dashboard/stations', label: 'Station Rules',      desc: 'Edit genres, ad policy, filler pools per station.',       icon: '📡' },
  { href: '/admin/dashboard/youtube',  label: 'YouTube Pool',       desc: 'Add or remove YouTube video / playlist IDs.',             icon: '▶️'  },
  { href: '/admin/dashboard/holidays', label: 'Holiday Overrides',  desc: 'Configure genre priorities and ad-free days.',            icon: '🎄' },
  { href: '/admin/dashboard/events',   label: 'Special Events',     desc: 'Inject one-off breaking news, marathons, sports.',        icon: '⚡' },
  { href: '/admin/dashboard/catalog',  label: 'Plex Catalog',       desc: 'Browse synced Plex media and block titles from scheduling.', icon: '🎞️' },
  { href: '/admin/dashboard/shows',    label: 'Show Progress',      desc: 'Reset or advance episode pointers for pinned shows.',     icon: '🎬' },
  { href: '/admin/dashboard/vhs',      label: 'VHS / CRT Effects',  desc: 'Tune scanlines, noise, chromatic aberration and flicker.', icon: '📼' },
  { href: '/admin/dashboard/audit',    label: 'Audit Log',          desc: 'Review every manual schedule change.',                    icon: '📋' },
]

export default function AdminDashboard() {
  const [mounted, setMounted] = useState(false)
  const [isCatalogSyncing, setIsCatalogSyncing] = useState(false)
  const [isSavingCatalogSettings, setIsSavingCatalogSettings] = useState(false)
  const [isSavingLibrarySelection, setIsSavingLibrarySelection] = useState(false)
  const [isClearingCatalog, setIsClearingCatalog] = useState(false)
  const [selectedLibraryKeys, setSelectedLibraryKeys] = useState<string[]>([])
  const [selectedLibraryClasses, setSelectedLibraryClasses] = useState<Record<string, string>>({})
  const [plexStatus, setPlexStatus] = useState<{
    connected: boolean
    hasToken: boolean
    hasServer: boolean
    plexServerName: string | null
    plexServerUrl: string | null
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

  const refreshPlexStatus = async () => {
    const data = await fetch('/api/admin/plex').then((r) => (r.ok ? r.json() : null)).catch(() => null)
    if (!data) return
    setPlexStatus(data)
    setIsCatalogSyncing(!!data.catalogSyncRunning)
    if (typeof data.catalog?.autoSyncMaxAgeHours === 'number') {
      setCatalogAutoSyncHours(String(data.catalog.autoSyncMaxAgeHours))
    }
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
    refreshPlexStatus().catch(() => {})
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
    if (!isCatalogSyncing) return
    const id = setInterval(() => {
      refreshPlexStatus().catch(() => {})
    }, 3000)
    return () => clearInterval(id)
  }, [isCatalogSyncing])

  return (
    <AdminShell>
      <h2 style={h2}>Overview</h2>
      <p style={{ color: '#4a7fb5', fontSize: '0.8rem', margin: '0 0 24px' }}>
        Select a section below to manage the broadcast system.
      </p>

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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
        {QUICK_LINKS.map((l) => (
          <Link key={l.href} href={l.href} style={card}>
            <div style={{ fontSize: '1.4rem', marginBottom: 8 }}>{l.icon}</div>
            <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e8f0fe', marginBottom: 6 }}>{l.label}</div>
            <div style={{ fontSize: '0.72rem', color: '#4a7fb5', lineHeight: 1.5 }}>{l.desc}</div>
          </Link>
        ))}
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
