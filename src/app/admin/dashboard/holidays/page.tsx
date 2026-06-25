'use client'

import { useState, useEffect } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface HolidaySetting { id: string; name: string; label: string; startMonth: number; startDay: number; endMonth: number; endDay: number; enabled: boolean }
interface StationOption { id: string; name: string }
interface CatalogFilterOption { value: string; count: number }
interface CatalogOptionsResponse { genres: CatalogFilterOption[]; languages: CatalogFilterOption[] }

const DEFAULT_HOLIDAY_SETTINGS: HolidaySetting[] = [
  { id: 'christmas', name: 'christmas', label: 'Christmas Day', startMonth: 12, startDay: 25, endMonth: 12, endDay: 25, enabled: true },
  { id: 'christmas_eve', name: 'christmas_eve', label: 'Christmas Eve', startMonth: 12, startDay: 24, endMonth: 12, endDay: 24, enabled: true },
  { id: 'good_friday', name: 'good_friday', label: 'Good Friday', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, enabled: true },
  { id: 'easter', name: 'easter', label: 'Easter Sunday', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, enabled: true },
  { id: 'halloween', name: 'halloween', label: 'Halloween', startMonth: 10, startDay: 31, endMonth: 10, endDay: 31, enabled: true },
]

interface HRow { id: string; holidayName: string; stationId: string | null; replaceSchedule: boolean; adFree: boolean; contentPriority: string; onceOffEvent: boolean; consumedAt?: string | null }
interface HolidayTagMap { [holiday: string]: string[] }

export default function HolidaysPage() {
  const [rows, setRows] = useState<HRow[]>([])
  const [holidaySettings, setHolidaySettings] = useState<HolidaySetting[]>(DEFAULT_HOLIDAY_SETTINGS)
  const [stations, setStations] = useState<StationOption[]>([{ id: 'stn', name: 'STN' }, { id: 'zbc', name: 'ZBC' }, { id: 'nnwk', name: 'NNWK' }, { id: 'seven', name: '7' }, { id: 'nine', name: '9' }, { id: 'ten', name: '10' }])
  const [catalogOptions, setCatalogOptions] = useState<CatalogOptionsResponse>({ genres: [], languages: [] })
  const [holidayTagMap, setHolidayTagMap] = useState<HolidayTagMap>({})
  const [form, setForm] = useState({ holidayName: 'christmas', stationId: '', replaceSchedule: true, adFree: false, contentPriority: '', onceOffEvent: false })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [holidayForm, setHolidayForm] = useState({ name: 'christmas', label: 'Christmas Day', startMonth: 12, startDay: 25, endMonth: 12, endDay: 25, enabled: true })
  const [holidayEditingId, setHolidayEditingId] = useState<string | null>(null)
  const [msg,  setMsg]  = useState('')

  const load = () => fetch('/api/admin/holidays').then(r => r.json()).then(setRows)
  useEffect(() => { load() }, [])

  const loadHolidaySettings = () => {
    fetch('/api/admin/holiday-settings')
      .then((r) => (r.ok ? r.json() : { settings: DEFAULT_HOLIDAY_SETTINGS }))
      .then((data) => {
        const settings = Array.isArray(data.settings) && data.settings.length > 0 ? data.settings : DEFAULT_HOLIDAY_SETTINGS
        setHolidaySettings(settings)
        const first = settings[0] ?? DEFAULT_HOLIDAY_SETTINGS[0]
        setHolidayForm((current) => holidayEditingId ? current : {
          name: first.name,
          label: first.label,
          startMonth: first.startMonth,
          startDay: first.startDay,
          endMonth: first.endMonth,
          endDay: first.endDay,
          enabled: first.enabled,
        })
        setForm((current) => {
          if (settings.some((setting: HolidaySetting) => setting.name === current.holidayName)) return current
          return { ...current, holidayName: first.name }
        })
      })
      .catch(() => setHolidaySettings(DEFAULT_HOLIDAY_SETTINGS))
  }

  useEffect(() => {
    fetch('/api/admin/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name: string }>) => {
        if (Array.isArray(rows) && rows.length > 0) setStations(rows.map((s) => ({ id: s.id, name: s.name || s.id.toUpperCase() })))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/admin/catalog/holiday-tags')
      .then((r) => (r.ok ? r.json() : { tagMap: {} }))
      .then((data) => setHolidayTagMap(data.tagMap || {}))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/admin/stations/catalog-options')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return
        setCatalogOptions({
          genres: Array.isArray(data.genres) ? data.genres : [],
          languages: Array.isArray(data.languages) ? data.languages : [],
        })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadHolidaySettings()
  }, [])

  const holidayOptionItems = holidaySettings.length > 0 ? holidaySettings : DEFAULT_HOLIDAY_SETTINGS
  const holidayLabel = (name: string) => holidayOptionItems.find((item) => item.name === name)?.label ?? name

  const saveHolidaySetting = async () => {
    const payload = { id: holidayEditingId, ...holidayForm }
    const r = await fetch('/api/admin/holiday-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    setMsg(r.ok ? '✓ Holiday setting saved.' : `✗ ${data.error ?? 'Failed to save holiday setting.'}`)
    if (r.ok) {
      setHolidayEditingId(null)
      loadHolidaySettings()
      load()
    }
  }

  const editHolidaySetting = (setting: HolidaySetting) => {
    setHolidayEditingId(setting.id)
    setHolidayForm({
      name: setting.name,
      label: setting.label,
      startMonth: setting.startMonth,
      startDay: setting.startDay,
      endMonth: setting.endMonth,
      endDay: setting.endDay,
      enabled: setting.enabled,
    })
    setMsg('Editing holiday setting.')
  }

  const deleteHolidaySetting = async (id: string) => {
    const confirmed = window.confirm('Delete this holiday setting and related tags/overrides?')
    if (!confirmed) return
    const r = await fetch(`/api/admin/holiday-settings/${id}`, { method: 'DELETE' })
    const data = await r.json().catch(() => ({}))
    setMsg(r.ok ? '✓ Holiday setting deleted.' : `✗ ${data.error ?? 'Failed to delete holiday setting.'}`)
    if (r.ok) {
      loadHolidaySettings()
      load()
    }
  }

  const clearHolidayForm = () => {
    setHolidayEditingId(null)
    setHolidayForm({
      name: holidayOptionItems[0]?.name ?? 'christmas',
      label: holidayOptionItems[0]?.label ?? 'Christmas Day',
      startMonth: holidayOptionItems[0]?.startMonth ?? 12,
      startDay: holidayOptionItems[0]?.startDay ?? 25,
      endMonth: holidayOptionItems[0]?.endMonth ?? 12,
      endDay: holidayOptionItems[0]?.endDay ?? 25,
      enabled: true,
    })
    setMsg('')
  }

  const save = async () => {
    const r = await fetch('/api/admin/holidays', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, stationId: form.stationId || null, id: editingId }),
    })
    setMsg(r.ok ? '✓ Saved.' : '✗ Failed.')
    if (r.ok) {
      setEditingId(null)
      load()
    }
  }

  const remove = async (id: string) => {
    const confirmed = window.confirm('Delete this holiday override?')
    if (!confirmed) return
    const r = await fetch(`/api/admin/holidays/${id}`, { method: 'DELETE' })
    setMsg(r.ok ? '✓ Deleted.' : '✗ Failed to delete.')
    if (r.ok) load()
  }

  const startEdit = (row: HRow) => {
    setEditingId(row.id)
    setForm({
      holidayName: row.holidayName,
      stationId: row.stationId ?? '',
      replaceSchedule: row.replaceSchedule,
      adFree: row.adFree,
      contentPriority: row.contentPriority,
      onceOffEvent: row.onceOffEvent,
    })
    setMsg('Editing holiday override.')
  }

  const clearForm = () => {
    setEditingId(null)
    setForm({ holidayName: 'christmas', stationId: '', replaceSchedule: true, adFree: false, contentPriority: '', onceOffEvent: false })
    setMsg('')
  }

  return (
    <AdminShell>
      <h2 style={h2}>Holiday Settings & Overrides</h2>
      <p style={sub}>Create your own holiday name, set its date range, and then use that holiday in catalog tags and recurring overrides.</p>

      <div style={{ ...card, marginTop: 16, marginBottom: 18 }}>
        <div style={introGrid}>
          <div>
            <h3 style={h3}>What this page controls</h3>
            <ul style={bulletList}>
              <li>Holiday settings are the named holidays the app can recognize.</li>
              <li>Each setting has a name, a display label, and a start/end date range.</li>
              <li>Those names are reused for Plex Catalog tags and recurring holiday overrides.</li>
            </ul>
          </div>
          <div style={{ color: '#a8c4e0', fontSize: '0.75rem', lineHeight: 1.6 }}>
            <div style={{ marginBottom: 8 }}><strong style={{ color: '#e8f0fe' }}>Create</strong> a new holiday with any stable name you want.</div>
            <div style={{ marginBottom: 8 }}><strong style={{ color: '#e8f0fe' }}>Edit</strong> its label or date range later.</div>
            <div><strong style={{ color: '#e8f0fe' }}>Delete</strong> holidays you no longer need.</div>
          </div>
        </div>
      </div>

      <div style={panelGrid}>
        <div style={card}>
          <h3 style={h3}>{holidayEditingId ? 'Edit Holiday Definition' : 'Create Holiday Definition'}</h3>
          <p style={panelNote}>Name is the stable key used by catalog tags and overrides. The label is what people see in the admin UI.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
            <Fld label="Holiday name">
              <input value={holidayForm.name} onChange={e => setHolidayForm({...holidayForm, name: e.target.value.replace(/\s+/g, '_').toLowerCase()})} style={inp} placeholder="halloween_weekend" />
            </Fld>
            <Fld label="Display label">
              <input value={holidayForm.label} onChange={e => setHolidayForm({...holidayForm, label: e.target.value})} style={inp} placeholder="Halloween Weekend" />
            </Fld>
            <Fld label="Start month">
              <input type="number" min={1} max={12} value={holidayForm.startMonth} onChange={e => setHolidayForm({...holidayForm, startMonth: Number(e.target.value)})} style={inp} />
            </Fld>
            <Fld label="Start day">
              <input type="number" min={1} max={31} value={holidayForm.startDay} onChange={e => setHolidayForm({...holidayForm, startDay: Number(e.target.value)})} style={inp} />
            </Fld>
            <Fld label="End month">
              <input type="number" min={1} max={12} value={holidayForm.endMonth} onChange={e => setHolidayForm({...holidayForm, endMonth: Number(e.target.value)})} style={inp} />
            </Fld>
            <Fld label="End day">
              <input type="number" min={1} max={31} value={holidayForm.endDay} onChange={e => setHolidayForm({...holidayForm, endDay: Number(e.target.value)})} style={inp} />
            </Fld>
          </div>
          <label style={checkLabel}><input type="checkbox" checked={holidayForm.enabled} onChange={e => setHolidayForm({...holidayForm, enabled: e.target.checked})} /> Holiday enabled</label>
          {msg && <p style={{ color: '#4CAF50', fontSize: '0.78rem', margin: '10px 0' }}>{msg}</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
            <button onClick={saveHolidaySetting} style={btn}>{holidayEditingId ? 'Update Holiday Definition' : 'Save Holiday Definition'}</button>
            {holidayEditingId && <button onClick={clearHolidayForm} style={{ ...btn, backgroundColor: '#1a3a6e' }}>Cancel Edit</button>}
          </div>
        </div>

        <div style={card}>
          <h3 style={h3}>Existing Holiday Definitions</h3>
          <p style={panelNote}>Use Edit to change the name or date range. Use Delete to remove a holiday entirely.</p>
          <div style={{ display: 'grid', gap: 10, maxHeight: 380, overflowY: 'auto', paddingRight: 4 }}>
            {holidayOptionItems.map((setting) => (
              <div key={setting.id} style={settingCard}>
                <div style={settingHeadRow}>
                  <div>
                    <div style={{ color: '#e8f0fe', fontWeight: 700, fontSize: '0.84rem' }}>{setting.label}</div>
                    <div style={{ color: '#4a7fb5', fontSize: '0.7rem' }}>{setting.name}</div>
                  </div>
                  <span style={pill(setting.enabled)}>{setting.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div style={settingMeta}>{`${setting.startMonth}/${setting.startDay} → ${setting.endMonth}/${setting.endDay}`}</div>
                <div style={settingMeta}>Tagged titles in Plex Catalog: {holidayTagMap[setting.name]?.length ?? 0}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <button onClick={() => editHolidaySetting(setting)} style={{ ...btn, padding: '3px 10px', fontSize: '0.65rem', backgroundColor: '#1a3a6e' }}>Edit</button>
                  <button onClick={() => deleteHolidaySetting(setting.id)} style={{ ...btn, padding: '3px 10px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ ...card, marginTop: 18 }}>
        <h3 style={h3}>Recurring Holiday Overrides</h3>
        <p style={panelNote}>Pick one of the holiday definitions above, then decide how that holiday should affect every matching date unless you mark it as one-off.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
          <Fld label="Holiday">
            <select value={form.holidayName} onChange={e => setForm({...form, holidayName: e.target.value})} style={sel}>
              {holidayOptionItems.map(h => <option key={h.name} value={h.name}>{h.label}</option>)}
            </select>
          </Fld>
          <Fld label="Station (optional)">
            <select value={form.stationId} onChange={e => setForm({...form, stationId: e.target.value})} style={sel}>
              <option value="">(all stations)</option>
              {stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Fld>
        </div>
        <SearchableGenrePicker
          label="Content priority genres"
          description="Search synced Plex genres and add the ones this holiday override should prioritize."
          value={form.contentPriority}
          options={catalogOptions.genres}
          emptyMessage="No synced genre options yet. Run a Plex catalog sync to populate this list."
          onChange={(nextValue) => setForm({ ...form, contentPriority: nextValue })}
        />
        <div style={{ display: 'flex', gap: 20, marginBottom: 14, flexWrap: 'wrap' }}>
          <label style={checkLabel}><input type="checkbox" checked={form.replaceSchedule} onChange={e => setForm({...form, replaceSchedule: e.target.checked})} /> Replace normal schedule</label>
          <label style={checkLabel}><input type="checkbox" checked={form.adFree} onChange={e => setForm({...form, adFree: e.target.checked})} /> Ad-free day</label>
          <label style={checkLabel}><input type="checkbox" checked={form.onceOffEvent} onChange={e => setForm({...form, onceOffEvent: e.target.checked})} /> Once-off event</label>
        </div>
        {msg && <p style={{ color: '#4CAF50', fontSize: '0.78rem', margin: '0 0 10px' }}>{msg}</p>}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={save} style={btn}>{editingId ? 'Update Override' : 'Save Override'}</button>
          {editingId && <button onClick={clearForm} style={{ ...btn, backgroundColor: '#1a3a6e' }}>Cancel Edit</button>}
        </div>

        <div style={{ overflowX: 'auto', marginTop: 18 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
                {['Holiday','Station','Replace','Ad-free','Once-off','Genres',''].map(h => (
                  <th key={h} style={{ padding: '7px 10px', textAlign: 'left', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid #0d1f3c' }}>
                  <td style={td}>{holidayLabel(r.holidayName)}</td>
                  <td style={td}>{r.stationId ?? 'All'}</td>
                  <td style={td}>{r.replaceSchedule ? '✓' : '—'}</td>
                  <td style={td}>{r.adFree ? '✓ Ad-free' : '—'}</td>
                  <td style={td}>{r.onceOffEvent ? '✓' : '—'}</td>
                  <td style={td}>{r.contentPriority || '—'}</td>
                  <td style={td}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button onClick={() => startEdit(r)} style={{ ...btn, padding: '3px 10px', fontSize: '0.65rem', backgroundColor: '#1a3a6e' }}>Edit</button>
                      <button onClick={() => remove(r.id)} style={{ ...btn, padding: '3px 10px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} style={{ ...td, color: '#4a7fb5', fontStyle: 'italic' }}>No overrides configured.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  )
}

function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label style={{ display: 'block', color: '#4a7fb5', fontSize: '0.65rem', marginBottom: 4 }}>{label.toUpperCase()}</label>{children}</div>
}

function normalizeRuleToken(value: string): string {
  return value.trim().toLowerCase()
}

function parseRuleTokens(value: string): string[] {
  return value
    .split(',')
    .map((item) => normalizeRuleToken(item))
    .filter(Boolean)
}

function formatRuleTokens(values: string[]): string {
  return values.join(', ')
}

function SearchableGenrePicker({
  label,
  description,
  value,
  options,
  emptyMessage,
  onChange,
}: {
  label: string
  description: string
  value: string
  options: CatalogFilterOption[]
  emptyMessage: string
  onChange: (nextValue: string) => void
}) {
  const [query, setQuery] = useState('')
  const selected = parseRuleTokens(value)
  const selectedSet = new Set(selected)
  const filtered = options
    .filter((option) => !selectedSet.has(option.value))
    .filter((option) => option.value.includes(normalizeRuleToken(query)))
    .slice(0, 18)

  const addValue = (rawValue: string) => {
    const normalized = normalizeRuleToken(rawValue)
    if (!normalized || selectedSet.has(normalized)) return
    onChange(formatRuleTokens([...selected, normalized]))
    setQuery('')
  }

  const removeValue = (token: string) => {
    onChange(formatRuleTokens(selected.filter((item) => item !== token)))
  }

  return (
    <Fld label={label}>
      <div style={pickerWrap}>
        <div style={pickerDescription}>{description}</div>
        <div style={chipWrap}>
          {selected.length > 0 ? selected.map((token) => (
            <button key={token} type="button" style={chipBtn} onClick={() => removeValue(token)}>
              {token} ×
            </button>
          )) : <div style={pickerEmpty}>No selections yet.</div>}
        </div>
        <div style={pickerControls}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault()
                addValue(query)
              }
            }}
            style={inp}
            placeholder="Search or type a genre, then press Enter"
          />
          <button type="button" style={ghostBtn} onClick={() => addValue(query)}>Add</button>
        </div>
        {options.length === 0 ? (
          <div style={pickerEmpty}>{emptyMessage}</div>
        ) : (
          <div style={suggestionsWrap}>
            {filtered.length > 0 ? filtered.map((option) => (
              <button key={option.value} type="button" style={suggestionBtn} onClick={() => addValue(option.value)}>
                <span>{option.value}</span>
                <span style={suggestionCount}>{option.count}</span>
              </button>
            )) : <div style={pickerEmpty}>No matching synced genres.</div>}
          </div>
        )}
        <div style={pickerHint}>Saved as comma-separated values for compatibility with the existing holiday override API.</div>
      </div>
    </Fld>
  )
}

const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const h3: React.CSSProperties = { margin: '0 0 14px', color: '#a8c4e0', fontSize: '0.82rem', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '6px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '7px 16px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em' }
const sel: React.CSSProperties = { backgroundColor: '#060f1e', border: '1px solid #1e3a5f', color: '#fff', padding: '7px 10px', fontSize: '0.78rem', width: '100%' }
const inp: React.CSSProperties = { ...sel, boxSizing: 'border-box' as const }
const td: React.CSSProperties  = { padding: '7px 10px', color: '#a8c4e0' }
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, color: '#a8c4e0', fontSize: '0.75rem', cursor: 'pointer' }
const card: React.CSSProperties = { backgroundColor: '#0a1628', border: '1px solid #1e3a5f', padding: 20 }
const panelGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 18 }
const introGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, alignItems: 'start' }
const bulletList: React.CSSProperties = { margin: '0', paddingLeft: 18, color: '#a8c4e0', fontSize: '0.75rem', lineHeight: 1.7 }
const panelNote: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.72rem', margin: '0 0 12px', lineHeight: 1.6 }
const settingCard: React.CSSProperties = { border: '1px solid #0d1f3c', padding: '10px 12px', backgroundColor: '#07111f' }
const settingHeadRow: React.CSSProperties = { display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: 10 }
const settingMeta: React.CSSProperties = { color: '#a8c4e0', fontSize: '0.72rem', marginTop: 4, lineHeight: 1.5 }
const pickerWrap: React.CSSProperties = { backgroundColor: '#07111f', border: '1px solid #1e3a5f', padding: 12, marginBottom: 14 }
const pickerDescription: React.CSSProperties = { color: '#89a9c7', fontSize: '0.72rem', marginBottom: 10, lineHeight: 1.45 }
const chipWrap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }
const chipBtn: React.CSSProperties = { backgroundColor: '#1a3a6e', border: '1px solid #4a7fb5', color: '#fff', padding: '5px 10px', fontSize: '0.72rem', cursor: 'pointer' }
const pickerControls: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10 }
const ghostBtn: React.CSSProperties = { backgroundColor: '#0f223c', border: '1px solid #4a7fb5', color: '#dbe9f8', padding: '0 14px', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer' }
const suggestionsWrap: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }
const suggestionBtn: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, backgroundColor: '#0a1628', border: '1px solid #1e3a5f', color: '#e8f0fe', padding: '8px 10px', fontSize: '0.72rem', cursor: 'pointer', textAlign: 'left' as const }
const suggestionCount: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.68rem' }
const pickerEmpty: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.72rem' }
const pickerHint: React.CSSProperties = { color: '#6388ad', fontSize: '0.68rem', marginTop: 10 }
const pill = (enabled: boolean): React.CSSProperties => ({
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: '0.65rem',
  fontWeight: 700,
  color: enabled ? '#123b1d' : '#4f2f00',
  backgroundColor: enabled ? '#9ee6ad' : '#ffd18a',
})
