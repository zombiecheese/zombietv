'use client'

import { useState, useEffect, useCallback } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface StationOption { id: string; name: string }
const DAYS      = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

interface ShowRow { id: string; stationId: string; plexShowKey: string; showTitle: string; nextSeason: number; nextEpisode: number; totalSeasons: number; totalEpisodes: number; airedWeekday: number; airedTime: string; isCompleted: boolean; lastAiredAt: string | null }

export default function ShowsPage() {
  const [shows,    setShows]    = useState<ShowRow[]>([])
  const [station,  setStation]  = useState('')
  const [stations, setStations] = useState<StationOption[]>([{ id: 'stn', name: 'STN' }, { id: 'zbc', name: 'ZBC' }, { id: 'nnwk', name: 'NNWK' }, { id: 'seven', name: '7' }, { id: 'nine', name: '9' }, { id: 'ten', name: '10' }])
  const [editing,  setEditing]  = useState<ShowRow | null>(null)
  const [editForm, setEditForm] = useState({ nextSeason: 1, nextEpisode: 1, isCompleted: false, airedWeekday: 0, airedTime: '' })
  const [msg,      setMsg]      = useState('')
  const [resettingAll, setResettingAll] = useState(false)

  const load = useCallback(async () => {
    const params = station ? `?stationId=${station}` : ''
    const r = await fetch(`/api/admin/shows${params}`)
    setShows(await r.json())
  }, [station])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/admin/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name: string }>) => {
        if (Array.isArray(rows) && rows.length > 0) setStations(rows.map((s) => ({ id: s.id, name: s.name || s.id.toUpperCase() })))
      })
      .catch(() => {})
  }, [])

  const openEdit = (s: ShowRow) => {
    setEditing(s)
    setEditForm({ nextSeason: s.nextSeason, nextEpisode: s.nextEpisode, isCompleted: s.isCompleted, airedWeekday: s.airedWeekday, airedTime: s.airedTime })
  }

  const saveEdit = async () => {
    if (!editing) return
    const r = await fetch(`/api/admin/shows/${editing.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    setMsg(r.ok ? '✓ Updated.' : '✗ Failed.')
    setEditing(null); load()
  }

  const removeShow = async (id: string) => {
    if (!confirm('Remove this show\'s timeslot lock? It will be re-assigned on the next scheduler run.')) return
    await fetch(`/api/admin/shows/${id}`, { method: 'DELETE' })
    load()
  }

  const resetToEp1 = (s: ShowRow) => {
    setEditing(s)
    setEditForm({ nextSeason: 1, nextEpisode: 1, isCompleted: false, airedWeekday: s.airedWeekday, airedTime: s.airedTime })
  }

  const resetAllShowProgress = async () => {
    if (!confirm('Reset all show progress pointers used by scheduler?')) return

    setResettingAll(true)
    const r = await fetch('/api/admin/shows/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const d = await r.json().catch(() => ({}))
    setResettingAll(false)

    if (!r.ok) {
      setMsg(d?.error || '✗ Failed to reset show progress.')
      return
    }

    setMsg(`✓ Reset show progress (${d.removedShowProgress ?? 0} records removed).`)
    load()
  }


  return (
    <AdminShell>
      <h2 style={h2}>Show Progress</h2>
      <p style={sub}>Each row is a TV series pinned to a broadcast slot. Advance or reset the episode pointer, or unlock the timeslot entirely.</p>

      <div style={{ display: 'flex', gap: 12, margin: '16px 0', flexWrap: 'wrap' }}>
        <select value={station} onChange={e => setStation(e.target.value)} style={sel}>
          <option value="">All stations</option>
          {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button onClick={load} style={btn}>Refresh</button>
        <button
          onClick={resetAllShowProgress}
          disabled={resettingAll}
          style={{ ...btn, backgroundColor: resettingAll ? '#333' : '#7a1f5c' }}
        >
          {resettingAll ? 'Resetting…' : 'Reset Show Progress'}
        </button>
      </div>

      {msg && <p style={{ color: '#ff6600', fontSize: '0.78rem', marginBottom: 12 }}>{msg}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
              {['Station','Show','Slot','Progress','Status','Actions'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shows.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #0d1f3c', opacity: s.isCompleted ? 0.5 : 1 }}>
                <td style={td}>{s.stationId.toUpperCase()}</td>
                <td style={{ ...td, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.showTitle}</td>
                <td style={td}>{DAYS[s.airedWeekday]} {s.airedTime}</td>
                <td style={td}>
                  S{s.nextSeason}E{s.nextEpisode}{' '}
                  <span style={{ color: '#1e3a5f', fontSize: '0.65rem' }}>/ {s.totalEpisodes} eps</span>
                </td>
                <td style={td}>
                  {s.isCompleted
                    ? <span style={{ color: '#4a7fb5' }}>Completed</span>
                    : <span style={{ color: '#4CAF50' }}>Active</span>
                  }
                </td>
                <td style={td}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button onClick={() => openEdit(s)}      style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem' }}>Edit</button>
                    <button onClick={() => resetToEp1(s)}    style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#1a3a6e' }}>Reset to S1E1</button>
                    <button onClick={() => removeShow(s.id)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Unlock</button>
                  </div>
                </td>
              </tr>
            ))}
            {shows.length === 0 && <tr><td colSpan={6} style={{ ...td, color: '#4a7fb5', fontStyle: 'italic' }}>No shows locked to timeslots yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <div style={overlayS}>
          <div style={modalS}>
            <h3 style={{ margin: '0 0 4px', color: '#ff6600', fontSize: '0.9rem' }}>Edit Episode Pointer</h3>
            <p style={{ margin: '0 0 16px', color: '#4a7fb5', fontSize: '0.72rem' }}>{editing.showTitle}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <Fld label="Next season"><input type="number" value={editForm.nextSeason} onChange={e => setEditForm({...editForm, nextSeason: Number(e.target.value)})} style={inp} min={1} /></Fld>
              <Fld label="Next episode"><input type="number" value={editForm.nextEpisode} onChange={e => setEditForm({...editForm, nextEpisode: Number(e.target.value)})} style={inp} min={1} /></Fld>
              <Fld label="Aired weekday">
                <select value={editForm.airedWeekday} onChange={e => setEditForm({...editForm, airedWeekday: Number(e.target.value)})} style={sel}>
                  {DAYS.map((d,i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </Fld>
              <Fld label="Aired time (HH:MM)"><input value={editForm.airedTime} onChange={e => setEditForm({...editForm, airedTime: e.target.value})} style={inp} placeholder="19:30" /></Fld>
            </div>
            <label style={checkLabel}><input type="checkbox" checked={editForm.isCompleted} onChange={e => setEditForm({...editForm, isCompleted: e.target.checked})} /> Mark series as completed</label>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={saveEdit} style={{ ...btn, flex: 1 }}>Save</button>
              <button onClick={() => setEditing(null)} style={{ ...btn, flex: 1, backgroundColor: '#333' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  )
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={{ display: 'block', color: '#4a7fb5', fontSize: '0.65rem', marginBottom: 4 }}>{label.toUpperCase()}</label>{children}</div>
}
const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '6px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '7px 14px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }
const sel: React.CSSProperties = { backgroundColor: '#060f1e', border: '1px solid #1e3a5f', color: '#fff', padding: '7px 10px', fontSize: '0.78rem', width: '100%' }
const inp: React.CSSProperties = { ...sel, boxSizing: 'border-box' as const }
const td: React.CSSProperties  = { padding: '7px 10px', color: '#a8c4e0' }
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, color: '#a8c4e0', fontSize: '0.75rem', cursor: 'pointer' }
const overlayS: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }
const modalS: React.CSSProperties  = { backgroundColor: '#0a1628', border: '1px solid #1e3a5f', padding: 28, width: '100%', maxWidth: 420, fontFamily: 'Arial, sans-serif' }
