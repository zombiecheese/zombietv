'use client'

import { useState, useEffect } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface StationOption { id: string; name: string }

const TYPES     = ['breaking_news','sports_overrun','marathon','custom']
const PRIOS     = ['high','medium','low']

interface Event { id: string; name: string; type: string; stationId: string | null; startTime: string; durationMins: number; priority: string; replaceSchedule: boolean; content: Record<string,unknown> }

export default function EventsPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [stations, setStations] = useState<StationOption[]>([{ id: 'stn', name: 'STN' }, { id: 'zbc', name: 'ZBC' }, { id: 'nnwk', name: 'NNWK' }, { id: 'seven', name: '7' }, { id: 'nine', name: '9' }, { id: 'ten', name: '10' }])
  const [form,   setForm]   = useState({ name: '', type: 'custom', stationId: '', startTime: '', durationMins: 60, priority: 'medium', replaceSchedule: false, contentSource: 'youtube', contentId: '', description: '' })
  const [msg,    setMsg]    = useState('')

  const load = () => fetch('/api/admin/events').then(r => r.json()).then(setEvents)
  useEffect(() => { load() }, [])

  useEffect(() => {
    fetch('/api/admin/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name: string }>) => {
        if (Array.isArray(rows) && rows.length > 0) setStations(rows.map((s) => ({ id: s.id, name: s.name || s.id.toUpperCase() })))
      })
      .catch(() => {})
  }, [])

  const save = async () => {
    if (!form.name || !form.startTime) { setMsg('Name and start time required.'); return }
    const r = await fetch('/api/admin/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name, type: form.type,
        stationId: form.stationId || null,
        startTime: new Date(form.startTime).toISOString(),
        durationMins: Number(form.durationMins),
        priority: form.priority,
        replaceSchedule: form.replaceSchedule,
        content: { source: form.contentSource, id: form.contentId, description: form.description },
      }),
    })
    setMsg(r.ok ? '✓ Event created.' : '✗ Failed.')
    if (r.ok) load()
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this event?')) return
    await fetch(`/api/admin/events/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <AdminShell>
      <h2 style={h2}>Special Events</h2>
      <p style={sub}>Inject one-off events (breaking news, sport overruns, marathons) that override the normal schedule.</p>

      <div style={{ backgroundColor: '#0a1628', border: '1px solid #1e3a5f', padding: 20, margin: '16px 0 24px' }}>
        <h3 style={h3}>Create Event</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
          <Fld label="Event name"><input value={form.name} onChange={e => setForm({...form, name: e.target.value})} style={inp} /></Fld>
          <Fld label="Type"><select value={form.type} onChange={e => setForm({...form, type: e.target.value})} style={sel}>{TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></Fld>
          <Fld label="Station"><select value={form.stationId} onChange={e => setForm({...form, stationId: e.target.value})} style={sel}><option value="">(all)</option>{stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Fld>
          <Fld label="Start time (local)"><input type="datetime-local" value={form.startTime} onChange={e => setForm({...form, startTime: e.target.value})} style={inp} /></Fld>
          <Fld label="Duration (mins)"><input type="number" value={form.durationMins} onChange={e => setForm({...form, durationMins: Number(e.target.value)})} style={inp} /></Fld>
          <Fld label="Priority"><select value={form.priority} onChange={e => setForm({...form, priority: e.target.value})} style={sel}>{PRIOS.map(p => <option key={p} value={p}>{p}</option>)}</select></Fld>
          <Fld label="Content source"><select value={form.contentSource} onChange={e => setForm({...form, contentSource: e.target.value})} style={sel}><option value="youtube">YouTube</option><option value="plex">Plex</option></select></Fld>
          <Fld label="Content ID"><input value={form.contentId} onChange={e => setForm({...form, contentId: e.target.value})} style={inp} placeholder="Video/Playlist/Plex key" /></Fld>
          <Fld label="Description"><input value={form.description} onChange={e => setForm({...form, description: e.target.value})} style={inp} /></Fld>
        </div>
        <label style={checkLabel}><input type="checkbox" checked={form.replaceSchedule} onChange={e => setForm({...form, replaceSchedule: e.target.checked})} /> Replace existing schedule for this window</label>
        {msg && <p style={{ color: '#4CAF50', fontSize: '0.78rem', margin: '10px 0 0' }}>{msg}</p>}
        <button onClick={save} style={{ ...btn, marginTop: 14 }}>Create Event</button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
              {['Name','Type','Station','Starts','Duration','Priority','Replace',''].map(h => (
                <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id} style={{ borderBottom: '1px solid #0d1f3c' }}>
                <td style={td}>{ev.name}</td>
                <td style={td}><span style={{ backgroundColor: '#1a3a6e', padding: '2px 6px', fontSize: '0.65rem' }}>{ev.type}</span></td>
                <td style={td}>{ev.stationId ?? 'All'}</td>
                <td style={td}>{new Date(ev.startTime).toLocaleString('en-AU',{dateStyle:'short',timeStyle:'short'})}</td>
                <td style={td}>{ev.durationMins}m</td>
                <td style={td}><span style={{ color: ev.priority === 'high' ? '#ff4444' : ev.priority === 'medium' ? '#ff6600' : '#4a7fb5' }}>{ev.priority}</span></td>
                <td style={td}>{ev.replaceSchedule ? '✓' : '—'}</td>
                <td style={td}><button onClick={() => remove(ev.id)} style={{ ...btn, padding: '3px 10px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Delete</button></td>
              </tr>
            ))}
            {events.length === 0 && <tr><td colSpan={8} style={{ ...td, color: '#4a7fb5', fontStyle: 'italic' }}>No upcoming events.</td></tr>}
          </tbody>
        </table>
      </div>
    </AdminShell>
  )
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={{ display: 'block', color: '#4a7fb5', fontSize: '0.65rem', marginBottom: 4 }}>{label.toUpperCase()}</label>{children}</div>
}
const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const h3: React.CSSProperties = { margin: '0 0 14px', color: '#a8c4e0', fontSize: '0.82rem', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '6px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '7px 16px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em' }
const sel: React.CSSProperties = { backgroundColor: '#060f1e', border: '1px solid #1e3a5f', color: '#fff', padding: '7px 10px', fontSize: '0.78rem', width: '100%' }
const inp: React.CSSProperties = { ...sel, boxSizing: 'border-box' as const }
const td: React.CSSProperties  = { padding: '7px 10px', color: '#a8c4e0' }
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, color: '#a8c4e0', fontSize: '0.75rem', cursor: 'pointer' }
