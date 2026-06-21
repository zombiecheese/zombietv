'use client'

import { Fragment, useState, useEffect, useCallback } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface StationOption { id: string; name: string }

const CATEGORIES = ['ads','music','bumpers','filler','special']

interface YTEntry { id: string; title: string; videoId: string | null; playlistId: string | null; isPlaylist: boolean; category: string; station: string | null; durationMins: number | null; scheduledCount: number; createdAt: string }

function extractVideoId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw

  try {
    const url = new URL(raw)
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()
    if (host === 'youtu.be') {
      const fromPath = url.pathname.split('/').filter(Boolean)[0] ?? ''
      return /^[A-Za-z0-9_-]{11}$/.test(fromPath) ? fromPath : null
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = url.searchParams.get('v')?.trim() ?? ''
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v

      const segments = url.pathname.split('/').filter(Boolean)
      const embedCandidate = segments[0] === 'embed' ? segments[1] : ''
      if (/^[A-Za-z0-9_-]{11}$/.test(embedCandidate ?? '')) return embedCandidate
    }
  } catch {
    // Fall through and return null for invalid/unrecognized values.
  }

  return null
}

function buildWatchUrl(videoIdRaw: string): string {
  const normalizedId = extractVideoId(videoIdRaw) ?? videoIdRaw
  return `https://www.youtube.com/watch?v=${encodeURIComponent(normalizedId)}`
}

export default function YouTubePage() {
  const [items, setItems]       = useState<YTEntry[]>([])
  const [stations, setStations] = useState<StationOption[]>([{ id: 'stn', name: 'STN' }, { id: 'zbc', name: 'ZBC' }, { id: 'nnwk', name: 'NNWK' }, { id: 'seven', name: '7' }, { id: 'nine', name: '9' }, { id: 'ten', name: '10' }])
  const [filter, setFilter]     = useState({ category: '', station: '' })
  const [form, setForm]         = useState({ title: '', videoId: '', playlistId: '', isPlaylist: false, category: 'music', station: '', durationMins: '' })
  const [msg, setMsg]           = useState('')
  const [editId, setEditId]     = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ title: '', category: '', station: '', durationMins: '' })

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (filter.category) params.set('category', filter.category)
    if (filter.station)  params.set('station',  filter.station)
    const r = await fetch(`/api/admin/youtube?${params}`)
    setItems(await r.json())
  }, [filter])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/admin/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name: string }>) => {
        if (Array.isArray(rows) && rows.length > 0) setStations(rows.map((s) => ({ id: s.id, name: s.name || s.id.toUpperCase() })))
      })
      .catch(() => {})
  }, [])

  const add = async () => {
    if (!form.title || !form.category) { setMsg('Title and category required.'); return }
    if (!form.videoId && !form.playlistId) { setMsg('Video ID or Playlist ID required.'); return }
    const r = await fetch('/api/admin/youtube', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, station: form.station || null, durationMins: form.durationMins ? Number(form.durationMins) : null }),
    })
    const data = await r.json().catch(() => null)
    if (r.ok && data?.importedCount != null) {
      setMsg(`✓ Imported ${data.importedCount} playlist item${data.importedCount === 1 ? '' : 's'}.`)
    } else {
      setMsg(r.ok ? '✓ Added.' : `✗ ${data?.error ?? 'Failed.'}`)
    }
    if (r.ok) { setForm({ title: '', videoId: '', playlistId: '', isPlaylist: false, category: 'music', station: '', durationMins: '' }); load() }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this entry?')) return
    await fetch(`/api/admin/youtube/${id}`, { method: 'DELETE' })
    load()
  }

  const saveEdit = async () => {
    if (!editId) return
    await fetch(`/api/admin/youtube/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...editForm, durationMins: editForm.durationMins ? Number(editForm.durationMins) : null, station: editForm.station || null }) })
    setEditId(null); load()
  }

  return (
    <AdminShell>
      <h2 style={h2}>YouTube Pool Manager</h2>
      <p style={sub}>Add YouTube videos used as ads, music, bumpers and filler. Playlist imports are expanded into individual video entries automatically.</p>

      {msg && <p style={{ color: '#ff6600', fontSize: '0.78rem', margin: '12px 0' }}>{msg}</p>}

      {/* Add form */}
      <div style={{ backgroundColor: '#0a1628', border: '1px solid #1e3a5f', padding: 20, marginTop: 16, marginBottom: 24 }}>
        <h3 style={h3}>Add New Entry</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
          <Fld label="Title"><input value={form.title} onChange={e => setForm({...form, title: e.target.value})} style={inp} /></Fld>
          <Fld label="Video ID (leave blank if playlist)"><input value={form.videoId} onChange={e => setForm({...form, videoId: e.target.value})} style={inp} placeholder="dQw4w9WgXcQ" /></Fld>
          <Fld label="Playlist ID (imports items)"><input value={form.playlistId} onChange={e => setForm({...form, playlistId: e.target.value})} style={inp} placeholder="PLxxxxx" /></Fld>
          <Fld label="Category">
            <select value={form.category} onChange={e => setForm({...form, category: e.target.value})} style={sel}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </Fld>
          <Fld label="Station (optional)">
            <select value={form.station} onChange={e => setForm({...form, station: e.target.value})} style={sel}>
              <option value="">(global)</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Fld>
          <Fld label="Duration mins (videos only)"><input type="number" value={form.durationMins} onChange={e => setForm({...form, durationMins: e.target.value})} style={inp} /></Fld>
        </div>
        <label style={checkLabel}>
          <input type="checkbox" checked={form.isPlaylist} onChange={e => setForm({...form, isPlaylist: e.target.checked})} />
          Import playlist items
        </label>
        <button onClick={add} style={{ ...btn, marginTop: 14 }}>Add to Pool</button>
      </div>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select value={filter.category} onChange={e => setFilter({...filter, category: e.target.value})} style={sel}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filter.station} onChange={e => setFilter({...filter, station: e.target.value})} style={sel}>
          <option value="">(global)</option>
          {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
              {['Title','ID','Type','Category','Station','Duration','Used','Actions'].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <Fragment key={item.id}>
                <tr style={{ borderBottom: '1px solid #0d1f3c' }}>
                  <td style={tdc}>{item.title}</td>
                  <td style={{ ...tdc, fontFamily: 'monospace', fontSize: '0.7rem' }}>{item.videoId ?? item.playlistId}</td>
                  <td style={tdc}>{item.isPlaylist ? 'Playlist' : 'Video'}</td>
                  <td style={tdc}><span style={{ backgroundColor: '#1a3a6e', padding: '2px 6px', fontSize: '0.65rem' }}>{item.category}</span></td>
                  <td style={tdc}>{item.station ?? 'global'}</td>
                  <td style={tdc}>{item.durationMins != null ? `${item.durationMins}m` : '—'}</td>
                  <td style={tdc}>{item.scheduledCount}</td>
                  <td style={tdc}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {item.videoId && !item.isPlaylist && (
                        <button
                          onClick={() => window.open(buildWatchUrl(item.videoId!), '_blank', 'noopener,noreferrer')}
                          style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#1a3a6e' }}
                        >
                          ▶ Preview
                        </button>
                      )}
                      <button onClick={() => { setEditId(item.id); setEditForm({ title: item.title, category: item.category, station: item.station ?? '', durationMins: item.durationMins?.toString() ?? '' }) }} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem' }}>Edit</button>
                      <button onClick={() => remove(item.id)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Del</button>
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
            {items.length === 0 && <tr><td colSpan={8} style={{ ...tdc, color: '#4a7fb5', fontStyle: 'italic' }}>No entries yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {editId && (
        <div style={overlayS}>
          <div style={modalS}>
            <h3 style={{ margin: '0 0 16px', color: '#ff6600', fontSize: '0.9rem' }}>Edit Entry</h3>
            <Fld label="Title"><input value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} style={inp} /></Fld>
            <Fld label="Category"><select value={editForm.category} onChange={e => setEditForm({...editForm, category: e.target.value})} style={sel}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></Fld>
            <Fld label="Station"><select value={editForm.station} onChange={e => setEditForm({...editForm, station: e.target.value})} style={sel}><option value="">(global)</option>{stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
            <Fld label="Duration (mins)"><input type="number" value={editForm.durationMins} onChange={e => setEditForm({...editForm, durationMins: e.target.value})} style={inp} /></Fld>
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button onClick={saveEdit} style={{ ...btn, flex: 1 }}>Save</button>
              <button onClick={() => setEditId(null)} style={{ ...btn, flex: 1, backgroundColor: '#333' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  )
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 10 }}><label style={{ display: 'block', color: '#4a7fb5', fontSize: '0.65rem', marginBottom: 4 }}>{label.toUpperCase()}</label>{children}</div>
}

const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const h3: React.CSSProperties = { margin: '0 0 14px', color: '#a8c4e0', fontSize: '0.82rem', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '6px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '7px 14px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em' }
const sel: React.CSSProperties = { backgroundColor: '#060f1e', border: '1px solid #1e3a5f', color: '#fff', padding: '7px 10px', fontSize: '0.78rem', width: '100%' }
const inp: React.CSSProperties = { ...sel, boxSizing: 'border-box' as const }
const tdc: React.CSSProperties = { padding: '7px 10px', color: '#a8c4e0' }
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, color: '#a8c4e0', fontSize: '0.75rem', cursor: 'pointer' }
const overlayS: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000 }
const modalS: React.CSSProperties  = { backgroundColor: '#0a1628', border: '1px solid #1e3a5f', padding: 28, width: '100%', maxWidth: 420, fontFamily: 'Arial, sans-serif' }
