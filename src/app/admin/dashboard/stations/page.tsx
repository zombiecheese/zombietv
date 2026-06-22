'use client'

import { useState, useEffect, useCallback } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface SlotVideo { enabled: boolean; videoId: string }
interface SlotLibraryWeights { tv_shows: number; movies: number; animation: number; fitness: number }
interface FillerWindow {
  durationMins: number  // Must be multiple of 30
  category: string      // 'ads', 'filler', 'music', 'news'
  openVideo: SlotVideo
  closeVideo: SlotVideo
}
interface SlotConfig {
  key: string
  name: string
  start: string   // 'HH:MM' or 'first'
  end: string     // 'HH:MM' or 'until_finished'
  enabled: boolean
  fillerWindows: FillerWindow[]  // empty = no filler windows
  openVideo: SlotVideo
  closeVideo: SlotVideo
  libraryWeights: SlotLibraryWeights
  allowGenres: string[]      // empty = any
  allowLanguages: string[]   // empty = any
}
type DayType = 'weekday' | 'weekend'
interface StationRules {
  ad_policy: { enabled: boolean; break_interval_tv: number; break_interval_movie: number }
  slot_config?: { weekday: SlotConfig[]; weekend: SlotConfig[] }
  // legacy fields are preserved untouched by this editor
  allow_genres?: string; deny_genres?: string; allow_languages?: string; deny_languages?: string
  time_blocks?: unknown
}
interface StationData {
  id: string; name: string
  rules: StationRules
  fillerPools?: { ads: string | null; music: string | null; bumpers: string | null }
  holidayOverrides?: Record<string, unknown>
  branding: { colour_theme: string; logo: string }
}

interface CatalogFilterOption {
  value: string
  count: number
}

interface CatalogOptionsResponse {
  genres: CatalogFilterOption[]
  languages: CatalogFilterOption[]
}

const BASE_STATION_IDS = new Set(['stn', 'zbc', 'nnwk', 'seven', 'nine', 'ten'])

const SLOT_TEMPLATE: Array<{ key: string; name: string; start: string; end: string }> = [
  { key: 'overnight',    name: 'Overnight',        start: 'first', end: '07:00' },
  { key: 'morning',      name: 'Morning',          start: '07:00', end: '09:00' },
  { key: 'late_morning', name: 'Late Morning',     start: '09:00', end: '12:00' },
  { key: 'midday',       name: 'Midday',           start: '12:00', end: '15:00' },
  { key: 'afternoon',    name: 'Afternoon',        start: '15:00', end: '17:00' },
  { key: 'evening_news', name: 'Evening News',     start: '17:00', end: '18:30' },
  { key: 'event_tv',     name: 'Event TV',         start: '18:30', end: '20:30' },
  { key: 'movie',        name: 'Movie',            start: '20:30', end: '23:00' },
  { key: 'late_movie',   name: 'Late Night Movie', start: '23:00', end: 'until_finished' },
]

function defaultSlot(t: { key: string; name: string; start: string; end: string }): SlotConfig {
  return {
    key: t.key, name: t.name, start: t.start, end: t.end,
    enabled: true,
    fillerWindows: [],
    openVideo: { enabled: false, videoId: '' },
    closeVideo: { enabled: false, videoId: '' },
    libraryWeights: { tv_shows: 1, movies: 1, animation: 0, fitness: 0 },
    allowGenres: [], allowLanguages: [],
  }
}

function mergeSlots(saved: unknown): SlotConfig[] {
  const arr = Array.isArray(saved) ? (saved as Partial<SlotConfig>[]) : []
  return SLOT_TEMPLATE.map((t) => {
    const found = arr.find((s) => s?.key === t.key)
    const base = defaultSlot(t)
    if (!found) return base
    return {
      ...base,
      ...found,
      key: t.key, name: t.name, start: t.start, end: t.end,
      openVideo: { ...base.openVideo, ...(found.openVideo ?? {}) },
      closeVideo: { ...base.closeVideo, ...(found.closeVideo ?? {}) },
      libraryWeights: { ...base.libraryWeights, ...(found.libraryWeights ?? {}) },
      fillerWindows: Array.isArray(found.fillerWindows) ? found.fillerWindows : base.fillerWindows,
      allowGenres: Array.isArray(found.allowGenres) ? found.allowGenres : [],
      allowLanguages: Array.isArray(found.allowLanguages) ? found.allowLanguages : [],
    }
  })
}

function ensureSlotConfig(rules: StationRules | undefined): { weekday: SlotConfig[]; weekend: SlotConfig[] } {
  const sc = rules?.slot_config
  return { weekday: mergeSlots(sc?.weekday), weekend: mergeSlots(sc?.weekend) }
}

export default function StationsPage() {
  const [stations, setStations] = useState<StationData[]>([])
  const [selected, setSelected] = useState<StationData | null>(null)
  const [form,     setForm]     = useState<StationData | null>(null)
  const [dayType,  setDayType]  = useState<DayType>('weekday')
  const [catalogOptions, setCatalogOptions] = useState<CatalogOptionsResponse>({ genres: [], languages: [] })
  const [msg,      setMsg]      = useState('')
  const [newStationId, setNewStationId] = useState('')
  const [newStationName, setNewStationName] = useState('')

  const loadStations = useCallback(async () => {
    const r = await fetch('/api/admin/stations')
    const data = await r.json()
    setStations(data)
  }, [])

  useEffect(() => {
    loadStations()
  }, [loadStations])

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

  const select = (s: StationData) => {
    const clone: StationData = JSON.parse(JSON.stringify(s))
    if (!clone.rules) clone.rules = { ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 } }
    if (!clone.rules.ad_policy) clone.rules.ad_policy = { enabled: true, break_interval_tv: 15, break_interval_movie: 30 }
    clone.rules.slot_config = ensureSlotConfig(clone.rules)
    if (!clone.branding) clone.branding = { colour_theme: '#2c3e50', logo: '' }
    setSelected(s)
    setForm(clone)
    setDayType('weekday')
    setMsg('')
  }

  const save = async () => {
    if (!form) return
    const r = await fetch(`/api/admin/stations/${form.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: form.rules, branding: form.branding }),
    })
    setMsg(r.ok ? '✓ Saved successfully.' : '✗ Save failed.')
    if (r.ok) { const updated = stations.map(s => s.id === form.id ? form : s); setStations(updated) }
  }

  const createStation = async () => {
    const id = newStationId.trim().toLowerCase()
    const name = newStationName.trim()
    if (!id || !name) {
      setMsg('Provide both station ID and name.')
      return
    }

    const r = await fetch('/api/admin/stations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    })
    const payload = await r.json().catch(() => ({}))

    if (!r.ok) {
      setMsg(`✗ ${payload.error ?? 'Could not create station.'}`)
      return
    }

    setNewStationId('')
    setNewStationName('')
    setMsg('✓ Station added.')
    await loadStations()
  }

  const removeStation = async () => {
    if (!selected) return
    if (BASE_STATION_IDS.has(selected.id)) {
      setMsg('✗ Base stations cannot be deleted.')
      return
    }
    const confirmed = window.confirm(`Delete station ${selected.id.toUpperCase()} and all its schedules/content links?`)
    if (!confirmed) return

    const r = await fetch(`/api/admin/stations/${selected.id}`, { method: 'DELETE' })
    const payload = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMsg(`✗ ${payload.error ?? 'Could not delete station.'}`)
      return
    }

    setSelected(null)
    setForm(null)
    setMsg('✓ Station removed.')
    await loadStations()
  }

  const setAdPolicy = (key: string, val: unknown) => setForm(f => f ? { ...f, rules: { ...f.rules, ad_policy: { ...f.rules.ad_policy, [key]: val } } } : f)

  const updateSlot = (index: number, patch: Partial<SlotConfig>) => setForm(f => {
    if (!f?.rules.slot_config) return f
    const list = f.rules.slot_config[dayType].map((slot, i) => i === index ? { ...slot, ...patch } : slot)
    return { ...f, rules: { ...f.rules, slot_config: { ...f.rules.slot_config, [dayType]: list } } }
  })

  const copyWeekdayToWeekend = () => setForm(f => {
    if (!f?.rules.slot_config) return f
    const cloned = JSON.parse(JSON.stringify(f.rules.slot_config.weekday)) as SlotConfig[]
    return { ...f, rules: { ...f.rules, slot_config: { ...f.rules.slot_config, weekend: cloned } } }
  })

  const slots = form?.rules.slot_config?.[dayType] ?? []

  return (
    <AdminShell>
      <h2 style={h2}>Station Rules</h2>
      <p style={sub}>Configure each station&apos;s weekday and weekend programming slots, station-wide ad policy, and branding. Filler content is managed in Filler Content; holiday behaviour in Holiday Overrides.</p>

      <Section title="Add Channel">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', gap: 10, alignItems: 'end' }}>
          <Field label="Channel ID (e.g. abc2)">
            <input
              value={newStationId}
              onChange={e => setNewStationId(e.target.value.replace(/\s+/g, '').toLowerCase())}
              style={inp}
              placeholder="lowercase id"
            />
          </Field>
          <Field label="Channel Name">
            <input value={newStationName} onChange={e => setNewStationName(e.target.value)} style={inp} placeholder="Display name" />
          </Field>
          <button onClick={createStation} style={{ ...btn, height: 38, alignSelf: 'end', padding: '0 18px', whiteSpace: 'nowrap', marginBottom: 0 }}>Add Channel</button>
        </div>
      </Section>

      <div style={{ display: 'flex', gap: 20, marginTop: 20, minHeight: 0 }}>
        {/* Station list */}
        <div style={{ width: 160, flexShrink: 0 }}>
          {stations.map(s => (
            <button key={s.id} onClick={() => select(s)} style={{
              display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px',
              backgroundColor: selected?.id === s.id ? '#1a3a6e' : '#0a1628',
              border: '1px solid', borderColor: selected?.id === s.id ? '#4a7fb5' : '#1e3a5f',
              color: '#fff', cursor: 'pointer', fontSize: '0.78rem', marginBottom: 6, letterSpacing: '0.05em', fontWeight: selected?.id === s.id ? 700 : 400,
            }}>
              {s.id.toUpperCase()}<br />
              <span style={{ fontSize: '0.6rem', color: '#4a7fb5', fontWeight: 400 }}>{s.name}</span>
            </button>
          ))}
        </div>

        {/* Editor */}
        {form && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {msg && <p style={{ color: '#4CAF50', fontSize: '0.78rem', margin: '0 0 12px' }}>{msg}</p>}

            <Section title="Programming Slots">
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
                {(['weekday', 'weekend'] as DayType[]).map((dt) => (
                  <button
                    key={dt}
                    type="button"
                    onClick={() => setDayType(dt)}
                    style={{
                      ...btn,
                      padding: '6px 16px',
                      backgroundColor: dayType === dt ? '#ff6600' : '#1e3a5f',
                    }}
                  >
                    {dt === 'weekday' ? 'WEEKDAY' : 'WEEKEND'}
                  </button>
                ))}
                {dayType === 'weekend' && (
                  <button type="button" onClick={copyWeekdayToWeekend} style={{ ...ghostBtn, padding: '6px 12px' }}>
                    Copy weekday → weekend
                  </button>
                )}
              </div>

              {slots.map((slot, index) => (
                <div key={slot.key} style={{ backgroundColor: '#060f1e', border: '1px solid #1e3a5f', padding: '12px 16px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: slot.enabled ? 12 : 0 }}>
                    <div>
                      <span style={{ color: '#e8f0fe', fontWeight: 700, fontSize: '0.82rem' }}>{slot.name}</span>
                      <span style={{ color: '#4a7fb5', fontSize: '0.68rem', marginLeft: 10 }}>
                        {slot.start === 'first' ? 'First available' : slot.start} – {slot.end === 'until_finished' ? 'Until content finished' : slot.end}
                      </span>
                    </div>
                    <label style={checkLabel}>
                      <input type="checkbox" checked={slot.enabled} onChange={e => updateSlot(index, { enabled: e.target.checked })} />
                      Enabled
                    </label>
                  </div>

                  {slot.enabled && (
                    <>
                      <FillerWindowsBuilder
                        slot={slot}
                        index={index}
                        updateSlot={updateSlot}
                      />

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div style={{ border: '1px solid #1e3a5f', padding: 10 }}>
                          <label style={checkLabel}>
                            <input type="checkbox" checked={slot.openVideo.enabled} onChange={e => updateSlot(index, { openVideo: { ...slot.openVideo, enabled: e.target.checked } })} />
                            Opening video
                          </label>
                          {slot.openVideo.enabled && (
                            <input value={slot.openVideo.videoId} onChange={e => updateSlot(index, { openVideo: { ...slot.openVideo, videoId: e.target.value } })} style={{ ...inp, marginTop: 8 }} placeholder="YouTube video ID / URL" />
                          )}
                        </div>
                        <div style={{ border: '1px solid #1e3a5f', padding: 10 }}>
                          <label style={checkLabel}>
                            <input type="checkbox" checked={slot.closeVideo.enabled} onChange={e => updateSlot(index, { closeVideo: { ...slot.closeVideo, enabled: e.target.checked } })} />
                            Closing video
                          </label>
                          {slot.closeVideo.enabled && (
                            <input value={slot.closeVideo.videoId} onChange={e => updateSlot(index, { closeVideo: { ...slot.closeVideo, videoId: e.target.value } })} style={{ ...inp, marginTop: 8 }} placeholder="YouTube video ID / URL" />
                          )}
                        </div>
                      </div>

                      {slot.fillerWindows.length === 0 && (
                        <>
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ color: '#4a7fb5', fontSize: '0.65rem', letterSpacing: '0.06em', marginBottom: 6 }}>LIBRARY WEIGHTS</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                              {(['tv_shows','movies','animation','fitness'] as const).map((lib) => (
                                <label key={lib} style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#a8c4e0', fontSize: '0.68rem' }}>
                                  {lib.replace('_', ' ')}
                                  <input type="number" min={0} max={10} step={1} value={slot.libraryWeights[lib]}
                                    onChange={e => updateSlot(index, { libraryWeights: { ...slot.libraryWeights, [lib]: Math.max(0, Number(e.target.value)) } })}
                                    style={inp} />
                                </label>
                              ))}
                            </div>
                          </div>

                          <TokenPicker
                            label="Allow genres"
                            anyLabel="Any genre"
                            options={catalogOptions.genres}
                            value={slot.allowGenres}
                            onChange={(next) => updateSlot(index, { allowGenres: next })}
                          />
                          <TokenPicker
                            label="Allow languages"
                            anyLabel="Any language"
                            options={catalogOptions.languages}
                            value={slot.allowLanguages}
                            onChange={(next) => updateSlot(index, { allowLanguages: next })}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
            </Section>

            <Section title="Ad Policy (station-wide)">
              <label style={checkLabel}>
                <input type="checkbox" checked={form.rules.ad_policy.enabled}
                  onChange={e => setAdPolicy('enabled', e.target.checked)} />
                Ads enabled on this station
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
                <Field label="TV show break interval (mins)">
                  <input type="number" value={form.rules.ad_policy.break_interval_tv}
                    onChange={e => setAdPolicy('break_interval_tv', Number(e.target.value))} style={inp} />
                </Field>
                <Field label="Movie break interval (mins)">
                  <input type="number" value={form.rules.ad_policy.break_interval_movie}
                    onChange={e => setAdPolicy('break_interval_movie', Number(e.target.value))} style={inp} />
                </Field>
              </div>
            </Section>

            <Section title="Branding">
              <Field label="Colour theme (hex)">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="color" value={form.branding.colour_theme}
                    onChange={e => setForm(f => f ? { ...f, branding: { ...f.branding, colour_theme: e.target.value } } : f)}
                    style={{ width: 48, height: 36, border: '1px solid #1e3a5f', cursor: 'pointer', background: 'none' }} />
                  <span style={{ color: '#a8c4e0', fontSize: '0.75rem' }}>{form.branding.colour_theme}</span>
                </div>
              </Field>
            </Section>

            <button onClick={save} style={{ ...btn, marginTop: 4 }}>Save Station Config</button>
            {!BASE_STATION_IDS.has(form.id) && (
              <button onClick={removeStation} style={{ ...btn, marginTop: 10, backgroundColor: '#8b1c1c' }}>
                Delete Channel
              </button>
            )}
          </div>
        )}
        {!form && <p style={{ color: '#4a7fb5', fontSize: '0.78rem' }}>Select a station to edit.</p>}
      </div>
    </AdminShell>
  )
function FillerWindowsBuilder({ slot, index, updateSlot }: { slot: SlotConfig; index: number; updateSlot: (idx: number, patch: Partial<SlotConfig>) => void }) {
  const FILLER_CATEGORIES = ['ads', 'filler', 'music', 'news'] as const
  const slotDurationMins = (() => {
    const start = slot.start === 'first' ? 0 : parseClockToMinutes(slot.start)
    const end = slot.end === 'until_finished' ? 24 * 60 : parseClockToMinutes(slot.end)
    return Math.max(0, end - start)
  })()
  
  const totalFillerMins = slot.fillerWindows.reduce((sum, w) => sum + w.durationMins, 0)
  const canAddMore = totalFillerMins < slotDurationMins
  
  const addWindow = () => {
    if (!canAddMore) return
    const newWindow: FillerWindow = {
      durationMins: 30,
      category: 'music',
      openVideo: { enabled: false, videoId: '' },
      closeVideo: { enabled: false, videoId: '' },
    }
    updateSlot(index, { fillerWindows: [...slot.fillerWindows, newWindow] })
  }
  
  const removeWindow = (windowIndex: number) => {
    updateSlot(index, { fillerWindows: slot.fillerWindows.filter((_, i) => i !== windowIndex) })
  }
  
  const updateWindow = (windowIndex: number, patch: Partial<FillerWindow>) => {
    const updated = slot.fillerWindows.map((w, i) => i === windowIndex ? { ...w, ...patch } : w)
    updateSlot(index, { fillerWindows: updated })
  }
  
  return (
    <div style={{ marginBottom: 12, backgroundColor: '#0a1628', border: '1px solid #1e3a5f', padding: 12 }}>
      <div style={{ color: '#4a7fb5', fontSize: '0.65rem', letterSpacing: '0.06em', marginBottom: 8 }}>FILLER WINDOWS (multiples of 30 mins)</div>
      <div style={{ color: '#a8c4e0', fontSize: '0.72rem', marginBottom: 10 }}>
        Slot duration: {slotDurationMins} mins | Used: {totalFillerMins} mins | Available: {slotDurationMins - totalFillerMins} mins
      </div>
      
      {slot.fillerWindows.map((window, windowIndex) => (
        <div key={windowIndex} style={{ backgroundColor: '#060f1e', border: '1px solid #1e3a5f', padding: 10, marginBottom: 8, borderRadius: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <div style={{ color: '#4a7fb5', fontSize: '0.65rem', fontWeight: 700 }}>Window {windowIndex + 1}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Duration (mins)">
                <select value={window.durationMins} onChange={e => updateWindow(windowIndex, { durationMins: Number(e.target.value) })} style={sel}>
                  {[30, 60, 90, 120, 150, 180, 210, 240].filter(d => d <= slotDurationMins).map(d => (
                    <option key={d} value={d}>{d} min{d === 30 ? '' : 's'} ({(d / 60).toFixed(1)}h)</option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select value={window.category} onChange={e => updateWindow(windowIndex, { category: e.target.value })} style={sel}>
                  {FILLER_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>)}
                </select>
              </Field>
            </div>
            <button onClick={() => removeWindow(windowIndex)} style={{ ...btn, padding: '6px 10px', fontSize: '0.65rem', backgroundColor: '#3d0000', height: 'fit-content' }}>Remove</button>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ border: '1px solid #1e3a5f', padding: 8, backgroundColor: '#0d1f3c' }}>
              <label style={checkLabel}>
                <input type="checkbox" checked={window.openVideo.enabled} onChange={e => updateWindow(windowIndex, { openVideo: { ...window.openVideo, enabled: e.target.checked } })} />
                Opening video
              </label>
              {window.openVideo.enabled && (
                <input value={window.openVideo.videoId} onChange={e => updateWindow(windowIndex, { openVideo: { ...window.openVideo, videoId: e.target.value } })} style={{ ...inp, marginTop: 6, fontSize: '0.7rem' }} placeholder="YouTube ID" />
              )}
            </div>
            <div style={{ border: '1px solid #1e3a5f', padding: 8, backgroundColor: '#0d1f3c' }}>
              <label style={checkLabel}>
                <input type="checkbox" checked={window.closeVideo.enabled} onChange={e => updateWindow(windowIndex, { closeVideo: { ...window.closeVideo, enabled: e.target.checked } })} />
                Closing video
              </label>
              {window.closeVideo.enabled && (
                <input value={window.closeVideo.videoId} onChange={e => updateWindow(windowIndex, { closeVideo: { ...window.closeVideo, videoId: e.target.value } })} style={{ ...inp, marginTop: 6, fontSize: '0.7rem' }} placeholder="YouTube ID" />
              )}
            </div>
          </div>
        </div>
      ))}
      
      <button onClick={addWindow} disabled={!canAddMore} style={{ ...btn, fontSize: '0.72rem', opacity: canAddMore ? 1 : 0.5, cursor: canAddMore ? 'pointer' : 'not-allowed' }}>
        + Add Filler Window
      </button>
    </div>
  )
}

function parseClockToMinutes(value: string): number {
  const parts = String(value).split(':')
  const hours = Number(parts[0]) || 0
  const mins = Number(parts[1]) || 0
  return hours * 60 + mins
}

const h2: React.CSSProperties
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ margin: '0 0 12px', color: '#4a7fb5', fontSize: '0.72rem', letterSpacing: '0.12em', textTransform: 'uppercase', borderBottom: '1px solid #1e3a5f', paddingBottom: 6 }}>{title}</h3>
      {children}
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{ display: 'block', color: '#4a7fb5', fontSize: '0.65rem', marginBottom: 4, letterSpacing: '0.06em' }}>{label.toUpperCase()}</label>
      {children}
    </div>
  )
}

function normalizeRuleToken(value: string): string {
  return value.trim().toLowerCase()
}

function TokenPicker({
  label,
  anyLabel,
  value,
  options,
  onChange,
}: {
  label: string
  anyLabel: string
  value: string[]
  options: CatalogFilterOption[]
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const isAny = value.length === 0
  const selectedSet = new Set(value)
  const filtered = options
    .filter((option) => !selectedSet.has(option.value))
    .filter((option) => option.value.includes(normalizeRuleToken(query)))
    .slice(0, 18)

  const addValue = (rawValue: string) => {
    const normalized = normalizeRuleToken(rawValue)
    if (!normalized || selectedSet.has(normalized)) return
    onChange([...value, normalized])
    setQuery('')
  }

  const removeValue = (token: string) => {
    onChange(value.filter((item) => item !== token))
  }

  return (
    <Field label={label}>
      <div style={pickerWrap}>
        <label style={{ ...checkLabel, marginBottom: 10 }}>
          <input type="checkbox" checked={isAny} onChange={(e) => { if (e.target.checked) onChange([]) }} />
          {anyLabel} (no filter)
        </label>
        <div style={chipWrap}>
          {value.length > 0 ? value.map((token) => (
            <button key={token} type="button" style={chipBtn} onClick={() => removeValue(token)}>
              {token} ×
            </button>
          )) : <div style={pickerEmpty}>Any allowed.</div>}
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
            placeholder="Search or type a value, then press Enter"
          />
          <button type="button" style={ghostBtn} onClick={() => addValue(query)}>Add</button>
        </div>
        {options.length > 0 && (
          <div style={suggestionsWrap}>
            {filtered.length > 0 ? filtered.map((option) => (
              <button key={option.value} type="button" style={suggestionBtn} onClick={() => addValue(option.value)}>
                <span>{option.value}</span>
                <span style={suggestionCount}>{option.count}</span>
              </button>
            )) : <div style={pickerEmpty}>No matching synced options.</div>}
          </div>
        )}
      </div>
    </Field>
  )
}

const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '6px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '9px 20px', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.06em' }
const inp: React.CSSProperties = { backgroundColor: '#060f1e', border: '1px solid #1e3a5f', color: '#fff', padding: '7px 10px', fontSize: '0.78rem', width: '100%', boxSizing: 'border-box' as const }
const checkLabel: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 7, color: '#a8c4e0', fontSize: '0.75rem', cursor: 'pointer' }
const pickerWrap: React.CSSProperties = { backgroundColor: '#07111f', border: '1px solid #1e3a5f', padding: 12 }
const chipWrap: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }
const chipBtn: React.CSSProperties = { backgroundColor: '#1a3a6e', border: '1px solid #4a7fb5', color: '#fff', padding: '5px 10px', fontSize: '0.72rem', cursor: 'pointer' }
const pickerControls: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 10 }
const ghostBtn: React.CSSProperties = { backgroundColor: '#0f223c', border: '1px solid #4a7fb5', color: '#dbe9f8', padding: '0 14px', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer' }
const suggestionsWrap: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }
const suggestionBtn: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, backgroundColor: '#0a1628', border: '1px solid #1e3a5f', color: '#e8f0fe', padding: '8px 10px', fontSize: '0.72rem', cursor: 'pointer', textAlign: 'left' as const }
const suggestionCount: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.68rem' }
const pickerEmpty: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.72rem' }
