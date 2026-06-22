'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import AdminShell from '@/components/admin/AdminShell'

const DEFAULT_STATIONS = ['stn','zbc','nnwk','seven','nine','ten']
const SOURCE_COLOURS: Record<string, string> = { plex: '#2e7d32', youtube: '#cc5500', filler: '#1a3a6e' }

interface StationOption {
  id: string
  name: string
}

interface Slot {
  id: string
  startTime: string
  durationMins: number
  contentSource: string
  contentId: string | null
  showTitle: string | null
  seasonNumber: number | null
  episodeNumber: number | null
  isOverride: boolean
  overrideReason: string | null
  metadata: Record<string, unknown>
  showPacing?: {
    nextSeason: number
    nextEpisode: number
    lastAiredAt: string | null
  }
}

interface ScheduleProgress {
  isRunning: boolean
  status?: {
    isRunning: boolean
    phase: 'idle' | 'starting' | 'loading_catalog' | 'scheduling' | 'finalizing' | 'complete' | 'error'
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
  lastManualRun?: {
    startedAt: string
    horizonDays: number
    stationId: string | null
    forceRegenerate: boolean
  } | null
  checkedAt: string
}

export default function SchedulePage() {
  const [station, setStation] = useState('zbc')
  const [regenScope, setRegenScope] = useState<'selected' | 'all'>('all')
  const [stations, setStations] = useState<StationOption[]>(DEFAULT_STATIONS.map((id) => ({ id, name: id.toUpperCase() })))
  const [date,    setDate]    = useState(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  })
  const [slots,   setSlots]   = useState<Slot[]>([])
  const [loading, setLoading] = useState(false)
  const [clearingSchedules, setClearingSchedules] = useState(false)
  const [editing, setEditing] = useState<Slot | null>(null)
  const [form,    setForm]    = useState({ contentSource: '', contentId: '', showTitle: '', reason: '' })
  const [msg,     setMsg]     = useState('')
  const [regen,   setRegen]   = useState(false)
  const [progress, setProgress] = useState<ScheduleProgress | null>(null)

  // Drag/drop state
  const dragId   = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/admin/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name: string }>) => {
        if (!alive || !Array.isArray(rows) || rows.length === 0) return
        const mapped = rows.map((row) => ({ id: row.id, name: row.name || row.id.toUpperCase() }))
        setStations(mapped)
        setStation((current) => (mapped.some((row) => row.id === current) ? current : mapped[0]?.id ?? current))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setMsg('')
    const r = await fetch(`/api/admin/schedule/${station}/${date}`)
    const d = await r.json()
    setSlots(d.slots ?? [])
    setLoading(false)
  }, [station, date])

  useEffect(() => { load() }, [load])

  const openEdit = (s: Slot) => {
    setEditing(s)
    setForm({
      contentSource: s.contentSource,
      contentId:     s.contentId ?? '',
      showTitle:     s.showTitle ?? '',
      reason:        '',
    })
  }

  const saveEdit = async () => {
    if (!editing) return
    const r = await fetch(`/api/admin/slots/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setMsg(r.ok ? 'Slot saved.' : 'Save failed.')
    setEditing(null)
    load()
  }

  const deleteSlot = async (id: string) => {
    if (!confirm('Remove this slot? It will be replaced with filler.')) return
    await fetch(`/api/admin/slots/${id}`, { method: 'DELETE' })
    load()
  }

  const triggerRegen = async () => {
    setRegen(true)
    const body: Record<string, unknown> = { horizonDays: 14 }
    if (regenScope === 'selected') body.stationId = station

    const r = await fetch('/api/scheduler/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setMsg(r.ok ? 'Scheduler triggered — check back in a moment.' : 'Trigger failed.')
    refreshProgress().catch(() => {})
    setRegen(false)
  }

  const clearSchedules = async () => {
    const scopeText = regenScope === 'selected' ? `selected station (${station.toUpperCase()})` : 'all stations'
    if (!confirm(`Clear schedules for ${scopeText}?`)) return

    setClearingSchedules(true)
    const body: Record<string, unknown> = {}
    if (regenScope === 'selected') body.stationId = station

    const r = await fetch('/api/admin/schedule/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    setClearingSchedules(false)

    if (!r.ok) {
      setMsg(d?.error || 'Failed to clear schedules.')
      return
    }

    setMsg(`Schedules cleared. Removed ${d.removedSchedules ?? 0} schedules and ${d.removedSlots ?? 0} slots.`)
    await load()
    refreshProgress().catch(() => {})
  }

  const refreshProgress = useCallback(async () => {
    const params = new URLSearchParams({ horizonDays: '14' })
    if (regenScope === 'selected') params.set('stationId', station)
    const r = await fetch(`/api/scheduler/run?${params.toString()}`)
    if (!r.ok) return
    const d = await r.json()
    setProgress(d)
  }, [regenScope, station])

  useEffect(() => {
    refreshProgress().catch(() => {})
    const timer = setInterval(() => {
      refreshProgress().catch(() => {})
    }, 3000)
    return () => clearInterval(timer)
  }, [refreshProgress])

  // Drag/drop handlers — swap content between two slots
  const handleDragStart = (id: string) => { dragId.current = id }
  const handleDragOver  = (e: React.DragEvent, id: string) => { e.preventDefault(); setDragOver(id) }
  const handleDragLeave = () => setDragOver(null)
  const handleDrop      = async (targetId: string) => {
    setDragOver(null)
    const sourceId = dragId.current
    dragId.current = null
    if (!sourceId || sourceId === targetId) return
    setMsg('Swapping slots…')
    const r = await fetch('/api/admin/slots/swap', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ slotAId: sourceId, slotBId: targetId, reason: 'Drag/drop swap via schedule editor' }),
    })
    setMsg(r.ok ? 'Slots swapped.' : 'Swap failed.')
    load()
  }

  return (
    <AdminShell>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={h2}>Schedule Editor</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => setRegenScope((current) => (current === 'all' ? 'selected' : 'all'))}
            style={{ ...btn, backgroundColor: '#1a3a6e' }}
            title={regenScope === 'all' ? 'Current scope: all stations' : `Current scope: selected station (${station.toUpperCase()})`}
          >
            {regenScope === 'all' ? 'ALL STATIONS' : `SELECTED: ${station.toUpperCase()}`}
          </button>
          <button onClick={triggerRegen} disabled={regen} style={{ ...btn, backgroundColor: regen ? '#333' : '#1a3a6e' }}>
            {regen ? 'Running…' : '⟳ Regenerate 14-Day Schedule'}
          </button>
          <button
            onClick={clearSchedules}
            disabled={clearingSchedules}
            style={{ ...btn, backgroundColor: clearingSchedules ? '#333' : '#8b1a1a' }}
          >
            {clearingSchedules ? 'Clearing…' : 'Clear Schedules'}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <select value={station} onChange={(e) => setStation(e.target.value)} style={sel}>
          {stations.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={sel} />
        <button onClick={load} style={btn}>Load</button>
      </div>

      {progress && (
        <div style={{ marginBottom: 16, border: '1px solid #1e3a5f', padding: 10, backgroundColor: '#081426' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ color: '#a8c4e0', fontSize: '0.72rem', letterSpacing: '0.04em' }}>
              {progress.status?.isRunning || progress.isRunning ? 'REGEN IN PROGRESS' : 'REGEN STATUS'}
              {regenScope === 'selected' ? ` · ${station.toUpperCase()}` : ' · ALL STATIONS'}
            </span>
            <span style={{ color: '#4a7fb5', fontSize: '0.7rem' }}>
              {progress.coverage.scheduledDays}/{progress.coverage.targetDays} days
            </span>
          </div>
          <div style={{ height: 10, backgroundColor: '#0a1628', border: '1px solid #1e3a5f' }}>
            <div
              style={{
                width: `${progress.coverage.progressPercent}%`,
                height: '100%',
                backgroundColor: progress.status?.isRunning || progress.isRunning ? '#ff6600' : '#2e7d32',
                transition: 'width 0.25s ease',
              }}
            />
          </div>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ color: '#a8c4e0', fontSize: '0.72rem' }}>{progress.coverage.progressPercent}%</span>
            <span style={{ color: '#4a7fb5', fontSize: '0.68rem' }}>Updated {new Date(progress.checkedAt).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</span>
          </div>
          {progress.status && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #1e3a5f', color: '#a8c4e0', fontSize: '0.72rem', lineHeight: 1.6 }}>
              <div>{`Phase: ${progress.status.phase}`}</div>
              <div>{`Scope: ${progress.status.stationId ? progress.status.stationId.toUpperCase() : 'ALL'} · horizon ${progress.status.horizonDays} days`}</div>
              <div>{`Stations: ${progress.status.stationsProcessed}/${progress.status.stationsTotal} · Days: ${progress.status.daysProcessed}/${progress.status.daysTotal} · Created: ${progress.status.daysCreated}`}</div>
              {progress.status.note ? <div>{progress.status.note}</div> : null}
              {progress.status.lastError ? <div style={{ color: '#ff8a80' }}>{`Last error: ${progress.status.lastError}`}</div> : null}
              {progress.status.startedAt ? <div style={{ color: '#4a7fb5' }}>{`Started ${new Date(progress.status.startedAt).toLocaleString()}`}</div> : null}
              {progress.status.finishedAt ? <div style={{ color: '#4a7fb5' }}>{`Finished ${new Date(progress.status.finishedAt).toLocaleString()}`}</div> : null}
            </div>
          )}
          {progress.lastManualRun ? (
            <div style={{ marginTop: 8, color: '#4a7fb5', fontSize: '0.68rem', lineHeight: 1.5 }}>
              {`Last manual trigger: ${new Date(progress.lastManualRun.startedAt).toLocaleString()} · ${progress.lastManualRun.forceRegenerate ? 'regeneration' : 'generation'} · ${progress.lastManualRun.stationId ? progress.lastManualRun.stationId.toUpperCase() : 'all stations'} · ${progress.lastManualRun.horizonDays} days`}
            </div>
          ) : null}
        </div>
      )}

      {msg && <p style={{ color: '#ff6600', fontSize: '0.78rem', marginBottom: 12 }}>{msg}</p>}

      {loading && <p style={{ color: '#4a7fb5', fontSize: '0.78rem' }}>Loading…</p>}

      {!loading && slots.length === 0 && (
        <p style={{ color: '#4a7fb5', fontSize: '0.78rem' }}>
          No schedule for this station/date. Click "Regenerate" to generate one.
        </p>
      )}

      {/* Slot table — rows are draggable; drag one onto another to swap their content */}
      {slots.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <p style={{ color: '#4a7fb5', fontSize: '0.68rem', margin: '0 0 10px', letterSpacing: '0.04em' }}>
            TIP: Drag any row onto another to swap their programme content.
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
                {['⠿','Time','Duration','Title','Source','S/E','Pacing','Override','Actions'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => {
                const isDropTarget = dragOver === s.id
                return (
                  <tr
                    key={s.id}
                    draggable
                    onDragStart={() => handleDragStart(s.id)}
                    onDragOver={(e) => handleDragOver(e, s.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={() => handleDrop(s.id)}
                    style={{
                      borderBottom: '1px solid #0d1f3c',
                      background: isDropTarget ? '#1a3a6e' : s.isOverride ? '#0d1a0d' : 'transparent',
                      cursor: 'grab',
                      outline: isDropTarget ? '2px solid #4a7fb5' : 'none',
                      transition: 'background 0.1s',
                    }}
                  >
                    <td style={{ ...td, color: '#2a4a6e', userSelect: 'none' }}>⠿</td>
                    <td style={td}>{new Date(s.startTime).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false})}</td>
                    <td style={td}>{s.durationMins}m</td>
                    <td style={{ ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(s.metadata?.title as string) ?? s.showTitle ?? '—'}
                    </td>
                    <td style={td}>
                      <span style={{ backgroundColor: SOURCE_COLOURS[s.contentSource] ?? '#333', padding: '2px 6px', fontSize: '0.65rem', color: '#fff' }}>
                        {s.contentSource}
                      </span>
                    </td>
                    <td style={td}>{s.seasonNumber != null ? `S${s.seasonNumber}E${s.episodeNumber}` : '—'}</td>
                    <td style={{ ...td, fontSize: '0.7rem', color: s.showPacing ? '#2e7d32' : '#4a7fb5' }}>
                      {s.showPacing
                        ? `S${s.showPacing.nextSeason}E${s.showPacing.nextEpisode}${s.showPacing.lastAiredAt ? ' (' + new Date(s.showPacing.lastAiredAt).toLocaleDateString('en-AU') + ')' : ''}`
                        : '—'}
                    </td>
                    <td style={td}>{s.isOverride ? <span style={{ color: '#ff6600' }}>✓ {s.overrideReason}</span> : '—'}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => openEdit(s)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem' }}>Edit</button>
                        <button onClick={() => deleteSlot(s.id)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Del</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      {editing && (
        <div style={overlay}>
          <div style={modal}>
            <h3 style={{ margin: '0 0 16px', color: '#ff6600', fontSize: '0.9rem' }}>Override Slot</h3>
            <p style={{ margin: '0 0 12px', color: '#4a7fb5', fontSize: '0.72rem' }}>
              {new Date(editing.startTime).toLocaleTimeString('en-AU',{hour:'2-digit',minute:'2-digit',hour12:false})}
              {' · '}{editing.durationMins}m
            </p>
            <Field label="Content Source">
              <select value={form.contentSource} onChange={(e) => setForm({...form, contentSource: e.target.value})} style={sel}>
                <option value="plex">Plex</option>
                <option value="youtube">YouTube</option>
                <option value="filler">Filler</option>
              </select>
            </Field>
            <Field label="Content ID (Plex ratingKey or YouTube ID)">
              <input value={form.contentId} onChange={(e) => setForm({...form, contentId: e.target.value})} style={inp} placeholder="e.g. 12345 or dQw4w9WgXcQ" />
            </Field>
            <Field label="Show / Programme Title">
              <input value={form.showTitle} onChange={(e) => setForm({...form, showTitle: e.target.value})} style={inp} />
            </Field>
            <Field label="Reason for override">
              <input value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} style={inp} placeholder="e.g. Special broadcast" />
            </Field>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={saveEdit} style={{ ...btn, flex: 1 }}>Save Override</button>
              <button onClick={() => setEditing(null)} style={{ ...btn, flex: 1, backgroundColor: '#333' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', color: '#4a7fb5', fontSize: '0.7rem', marginBottom: 5, letterSpacing: '0.06em' }}>{label.toUpperCase()}</label>
      {children}
    </div>
  )
}

const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '7px 14px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em' }
const sel: React.CSSProperties = { backgroundColor: '#0a1628', border: '1px solid #1e3a5f', color: '#fff', padding: '7px 10px', fontSize: '0.78rem', cursor: 'pointer' }
const inp: React.CSSProperties = { ...sel, width: '100%', boxSizing: 'border-box' as const }
const td: React.CSSProperties  = { padding: '7px 10px', color: '#a8c4e0' }
const overlay: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }
const modal: React.CSSProperties  = { backgroundColor: '#0a1628', border: '1px solid #1e3a5f', padding: 28, width: '100%', maxWidth: 480, fontFamily: 'Arial, sans-serif' }
