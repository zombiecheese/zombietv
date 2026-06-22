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
  strip: boolean             // weeknight strip: Mon–Fri, one series, daily episodes
}
type DayType = 'weekday' | 'weekend'
interface StationRules {
  ad_policy: { enabled: boolean; break_interval_tv: number; break_interval_movie: number }
  slot_config?: { weekday: SlotConfig[]; weekend: SlotConfig[] }
  allow_languages?: string[] | string
  deny_languages?: string[] | string
  overnight_closedown?: boolean
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
    allowGenres: [],
    strip: false,
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
      strip: Boolean(found.strip),
    }
  })
}

function ensureSlotConfig(rules: StationRules | undefined): { weekday: SlotConfig[]; weekend: SlotConfig[] } {
  const sc = rules?.slot_config
  return { weekday: mergeSlots(sc?.weekday), weekend: mergeSlots(sc?.weekend) }
}

// ─── 1990s network archetype presets ─────────────────────────────────────────
// Each preset seeds a sensible ad policy, language filters and slot mix the
// admin can then fine-tune. Library mix uses the four catalog classes.
type PresetKind = 'public' | 'commercial' | 'youth' | 'multicultural' | 'japanese'
interface PresetSlot { weights?: Partial<SlotLibraryWeights>; genres?: string[]; strip?: boolean; filler?: string }
interface NetworkPreset {
  label: string
  note: string
  ad: { enabled: boolean; break_interval_tv: number; break_interval_movie: number }
  allow_languages: string[]
  deny_languages: string[]
  closedown: boolean
  slots: Partial<Record<string, PresetSlot>>
}

const NETWORK_PRESETS: Record<PresetKind, NetworkPreset> = {
  public: {
    label: 'Public Broadcaster (ABC / ZBC)',
    note: 'Ad-free, kids mornings + after-school strip, documentary/drama prime.',
    ad: { enabled: false, break_interval_tv: 0, break_interval_movie: 0 },
    allow_languages: ['english'],
    deny_languages: [],
    closedown: true,
    slots: {
      overnight:    { filler: 'closedown' },
      morning:      { weights: { animation: 3, tv_shows: 1 }, genres: ['children', 'animation'] },
      late_morning: { weights: { tv_shows: 2 }, genres: ['documentary', 'lifestyle'] },
      midday:       { weights: { tv_shows: 2, movies: 1 }, genres: ['documentary'] },
      afternoon:    { weights: { animation: 3, tv_shows: 1 }, genres: ['children'], strip: true },
      event_tv:     { weights: { tv_shows: 2 }, genres: ['uk-drama', 'documentary'] },
      movie:        { weights: { movies: 3 }, genres: ['drama'] },
      late_movie:   { weights: { movies: 2 } },
    },
  },
  commercial: {
    label: 'Commercial Network (Seven / Nine)',
    note: 'Ads on, midday movie, weeknight soap strip, 8:30 movie/drama.',
    ad: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 },
    allow_languages: ['english'],
    deny_languages: [],
    closedown: false,
    slots: {
      late_morning: { weights: { tv_shows: 2 }, genres: ['lifestyle', 'reality'] },
      midday:       { weights: { movies: 2, tv_shows: 1 } },
      afternoon:    { weights: { tv_shows: 2 }, genres: ['drama'], strip: true },
      event_tv:     { weights: { tv_shows: 2, movies: 1 }, genres: ['drama', 'sitcom'] },
      movie:        { weights: { movies: 3 } },
      late_movie:   { weights: { movies: 2 } },
    },
  },
  youth: {
    label: 'Youth Commercial (Ten)',
    note: 'Ads on, teen/comedy/action prime, late-night teen movies.',
    ad: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 },
    allow_languages: ['english'],
    deny_languages: [],
    closedown: false,
    slots: {
      afternoon:    { weights: { tv_shows: 2, animation: 1 }, genres: ['teen', 'comedy'], strip: true },
      event_tv:     { weights: { tv_shows: 2 }, genres: ['teen', 'comedy', 'action'] },
      movie:        { weights: { movies: 3 }, genres: ['action', 'comedy'] },
      late_movie:   { weights: { movies: 2 }, genres: ['teen'] },
    },
  },
  multicultural: {
    label: 'Multicultural (SBS / STN)',
    note: 'No in-program ads, foreign-language drama and world cinema.',
    ad: { enabled: false, break_interval_tv: 0, break_interval_movie: 0 },
    allow_languages: ['chinese', 'french', 'spanish', 'italian', 'german', 'arabic', 'greek', 'vietnamese'],
    deny_languages: ['japanese', 'korean'],
    closedown: true,
    slots: {
      late_morning: { weights: { tv_shows: 2 }, genres: ['foreign', 'multicultural'] },
      midday:       { weights: { tv_shows: 2 }, genres: ['foreign', 'drama'] },
      event_tv:     { weights: { tv_shows: 2 }, genres: ['world-movies', 'documentary'] },
      movie:        { weights: { movies: 3 }, genres: ['art-house', 'world-movies'] },
      late_movie:   { weights: { movies: 2 } },
    },
  },
  japanese: {
    label: 'Japanese (Nippon Network)',
    note: 'Strictly Japanese — anime mornings strip, J-drama prime.',
    ad: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 },
    allow_languages: ['japanese'],
    deny_languages: ['korean', 'english'],
    closedown: false,
    slots: {
      morning:      { weights: { animation: 3 }, genres: ['anime'], strip: true },
      afternoon:    { weights: { animation: 2, tv_shows: 1 }, genres: ['anime'], strip: true },
      event_tv:     { weights: { tv_shows: 2 }, genres: ['japanese-drama'] },
      movie:        { weights: { movies: 2 }, genres: ['anime', 'japanese-drama'] },
      late_movie:   { weights: { movies: 2 } },
    },
  },
}

function buildPresetSlots(preset: NetworkPreset): SlotConfig[] {
  return SLOT_TEMPLATE.map((t) => {
    const base = defaultSlot(t)
    const o = preset.slots[t.key]
    if (!o) return base
    if (o.filler) {
      return {
        ...base,
        libraryWeights: { tv_shows: 0, movies: 0, animation: 0, fitness: 0 },
        allowGenres: [],
        strip: false,
        fillerWindows: [{ durationMins: 30, category: o.filler, openVideo: { enabled: false, videoId: '' }, closeVideo: { enabled: false, videoId: '' } }],
      }
    }
    return {
      ...base,
      libraryWeights: o.weights
        ? { tv_shows: 0, movies: 0, animation: 0, fitness: 0, ...o.weights }
        : base.libraryWeights,
      allowGenres: o.genres ?? [],
      strip: Boolean(o.strip),
      fillerWindows: [],
    }
  })
}

function asRuleTokenArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeRuleToken(String(v))).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((v) => normalizeRuleToken(v)).filter(Boolean)
  }
  return []
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
  const [savedSnapshot, setSavedSnapshot] = useState('')

  const snapshotOf = (f: StationData) => JSON.stringify({ rules: f.rules, branding: f.branding })
  const dirty = !!form && snapshotOf(form) !== savedSnapshot

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

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const select = (s: StationData) => {
    if (dirty && !window.confirm('You have unsaved changes. Discard them and switch station?')) return
    const clone: StationData = JSON.parse(JSON.stringify(s))
    if (!clone.rules) clone.rules = { ad_policy: { enabled: true, break_interval_tv: 15, break_interval_movie: 30 } }
    if (!clone.rules.ad_policy) clone.rules.ad_policy = { enabled: true, break_interval_tv: 15, break_interval_movie: 30 }
    clone.rules.allow_languages = asRuleTokenArray(clone.rules.allow_languages)
    clone.rules.deny_languages = asRuleTokenArray(clone.rules.deny_languages)
    clone.rules.slot_config = ensureSlotConfig(clone.rules)
    if (!clone.branding) clone.branding = { colour_theme: '#2c3e50', logo: '' }
    setSelected(s)
    setForm(clone)
    setSavedSnapshot(snapshotOf(clone))
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
    if (r.ok) { const updated = stations.map(s => s.id === form.id ? form : s); setStations(updated); setSavedSnapshot(snapshotOf(form)) }
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
  const setOvernightClosedown = (val: boolean) => setForm(f => f ? { ...f, rules: { ...f.rules, overnight_closedown: val } } : f)
  const setStationLanguages = (key: 'allow_languages' | 'deny_languages', next: string[]) => setForm(f => {
    if (!f) return f
    return { ...f, rules: { ...f.rules, [key]: next } }
  })

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

  const applyPreset = (kind: PresetKind) => {
    const preset = NETWORK_PRESETS[kind]
    if (!window.confirm(`Apply the "${preset.label}" preset? This replaces the current ad policy, language filters and programming slots.`)) return
    setForm(f => {
      if (!f) return f
      const weekday = buildPresetSlots(preset)
      const weekend = JSON.parse(JSON.stringify(weekday)) as SlotConfig[]
      return {
        ...f,
        rules: {
          ...f.rules,
          ad_policy: { ...preset.ad },
          allow_languages: [...preset.allow_languages],
          deny_languages: [...preset.deny_languages],
          overnight_closedown: preset.closedown,
          slot_config: { weekday, weekend },
        },
      }
    })
    setMsg(`Applied "${preset.label}" preset — review and Save to keep it.`)
  }

  const slots = form?.rules.slot_config?.[dayType] ?? []

  return (
    <AdminShell>
      <h2 style={h2}>Station Rules</h2>
      <p style={sub}>Configure each station&apos;s weekday and weekend programming slots, station-wide ad policy, and branding. Each slot is either <strong style={{ color: '#a8c4e0' }}>Programming</strong> (catalog content by library mix) or <strong style={{ color: '#a8c4e0' }}>Filler</strong> (curated YouTube windows). Filler content is managed in Filler Content; holiday behaviour in Holiday Overrides.</p>

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

            <Section title="Network Presets">
              <p style={{ color: '#4a7fb5', fontSize: '0.72rem', margin: '0 0 10px' }}>
                Apply a 1990s network archetype as a starting point, then fine-tune the slots below.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(Object.keys(NETWORK_PRESETS) as PresetKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => applyPreset(kind)}
                    title={NETWORK_PRESETS[kind].note}
                    style={{ ...ghostBtn, padding: '8px 14px', height: 'auto' }}
                  >
                    {NETWORK_PRESETS[kind].label}
                  </button>
                ))}
              </div>
            </Section>

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

              <SlotTimeline slots={slots} />

              {slots.map((slot, index) => (
                <div key={slot.key} style={{ backgroundColor: '#060f1e', border: '1px solid #1e3a5f', padding: '12px 16px', marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: slot.enabled ? 12 : 0 }}>
                    <div>
                      <div>
                        <span style={{ color: '#e8f0fe', fontWeight: 700, fontSize: '0.82rem' }}>{slot.name}</span>
                        <span style={{ color: '#4a7fb5', fontSize: '0.68rem', marginLeft: 10 }}>
                          {slot.start === 'first' ? 'First available' : slot.start} – {slot.end === 'until_finished' ? 'Until content finished' : slot.end}
                        </span>
                        {slot.enabled && (
                          <span style={{
                            marginLeft: 10, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.05em',
                            padding: '2px 7px', borderRadius: 3,
                            backgroundColor: slotMode(slot) === 'filler' ? '#33415a' : '#1a3a6e',
                            color: '#cfe0f5', border: '1px solid #1e3a5f',
                          }}>
                            {slotMode(slot) === 'filler' ? 'FILLER' : 'PROGRAMMING'}
                          </span>
                        )}
                      </div>
                      <div style={{ color: '#88a8cc', fontSize: '0.66rem', marginTop: 4 }}>{slotSummary(slot)}</div>
                    </div>
                    <label style={checkLabel}>
                      <input type="checkbox" checked={slot.enabled} onChange={e => updateSlot(index, { enabled: e.target.checked })} />
                      Enabled
                    </label>
                  </div>

                  {slot.enabled && (
                    <>
                      <SlotModeToggle slot={slot} index={index} updateSlot={updateSlot} />

                      {slotMode(slot) === 'filler' ? (
                        <FillerWindowsBuilder
                          slot={slot}
                          index={index}
                          updateSlot={updateSlot}
                        />
                      ) : (
                        <>
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

                          <LibraryWeightsEditor slot={slot} index={index} updateSlot={updateSlot} />

                          <label style={{ ...checkLabel, marginBottom: 12 }}>
                            <input type="checkbox" checked={slot.strip} onChange={e => updateSlot(index, { strip: e.target.checked })} />
                            Weeknight strip (Mon–Fri: one series owns this slot, advancing one episode per day)
                          </label>

                          <TokenPicker
                            label="Allow genres"
                            anyLabel="Any genre"
                            options={catalogOptions.genres}
                            value={slot.allowGenres}
                            onChange={(next) => updateSlot(index, { allowGenres: next })}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>
              ))}
            </Section>

            <Section title="Language Filters (station-wide)">
              <p style={{ color: '#4a7fb5', fontSize: '0.72rem', margin: '0 0 10px' }}>
                These language filters apply across all slots and windows for this station.
              </p>
              <TokenPicker
                label="Allow languages"
                anyLabel="Any language"
                options={catalogOptions.languages}
                value={asRuleTokenArray(form.rules.allow_languages)}
                onChange={(next) => setStationLanguages('allow_languages', next)}
              />
              <TokenPicker
                label="Deny languages"
                anyLabel="Do not deny any language"
                options={catalogOptions.languages}
                value={asRuleTokenArray(form.rules.deny_languages)}
                onChange={(next) => setStationLanguages('deny_languages', next)}
              />
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

            <Section title="Transmission (station-wide)">
              <label style={checkLabel}>
                <input type="checkbox" checked={Boolean(form.rules.overnight_closedown)}
                  onChange={e => setOvernightClosedown(e.target.checked)} />
                Overnight close-down
              </label>
              <p style={{ color: '#4a7fb5', fontSize: '0.7rem', margin: '6px 0 0' }}>
                When on, the deep-overnight infomercial windows play a transmission-pause (test pattern) loop instead of programming — the way ABC/SBS-style channels closed down overnight in the 1990s.
              </p>
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
            {dirty && (
              <span style={{ color: '#e0a030', fontSize: '0.72rem', marginLeft: 12 }}>● Unsaved changes</span>
            )}
            <button onClick={removeStation} style={{ ...btn, marginTop: 10, backgroundColor: '#8b1c1c' }}>
              Delete Channel
            </button>
          </div>
        )}
        {!form && <p style={{ color: '#4a7fb5', fontSize: '0.78rem' }}>Select a station to edit.</p>}
      </div>
    </AdminShell>
  )
}

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

function SlotModeToggle({ slot, index, updateSlot }: { slot: SlotConfig; index: number; updateSlot: (idx: number, patch: Partial<SlotConfig>) => void }) {
  const mode = slotMode(slot)
  const toProgramming = () => {
    if (mode === 'programming') return
    const hasWeights = SLOT_LIBS.some((l) => (slot.libraryWeights[l] || 0) > 0)
    updateSlot(index, {
      fillerWindows: [],
      libraryWeights: hasWeights ? slot.libraryWeights : { tv_shows: 1, movies: 1, animation: 0, fitness: 0 },
    })
  }
  const toFiller = () => {
    if (mode === 'filler') return
    updateSlot(index, {
      libraryWeights: { tv_shows: 0, movies: 0, animation: 0, fitness: 0 },
      allowGenres: [],
      fillerWindows: slot.fillerWindows.length
        ? slot.fillerWindows
        : [{ durationMins: 30, category: 'music', openVideo: { enabled: false, videoId: '' }, closeVideo: { enabled: false, videoId: '' } }],
    })
  }
  const tab = (active: boolean): React.CSSProperties => ({ ...btn, padding: '6px 16px', backgroundColor: active ? '#ff6600' : '#1e3a5f', fontSize: '0.7rem' })
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: '#4a7fb5', fontSize: '0.62rem', letterSpacing: '0.06em', marginBottom: 6 }}>SLOT MODE</div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={toProgramming} style={tab(mode === 'programming')}>PROGRAMMING</button>
        <button type="button" onClick={toFiller} style={tab(mode === 'filler')}>FILLER</button>
        <span style={{ color: '#6a86a8', fontSize: '0.62rem' }}>
          {mode === 'programming'
            ? 'Plays catalog content weighted by the library mix below.'
            : 'Plays curated YouTube filler windows only — no catalog programming.'}
        </span>
      </div>
    </div>
  )
}

function LibraryWeightsEditor({ slot, index, updateSlot }: { slot: SlotConfig; index: number; updateSlot: (idx: number, patch: Partial<SlotConfig>) => void }) {
  const breakdown = weightBreakdown(slot)
  const total = breakdown.reduce((sum, b) => sum + b.weight, 0)
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: '#4a7fb5', fontSize: '0.65rem', letterSpacing: '0.06em', marginBottom: 6 }}>
        LIBRARY MIX <span style={{ color: '#6a86a8', textTransform: 'none', letterSpacing: 0 }}>(relative share of programming)</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
        {breakdown.map(({ lib, weight, pct }) => (
          <label key={lib} style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#a8c4e0', fontSize: '0.68rem' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span>{labelForLib(lib)}</span>
              <span style={{ color: total > 0 && weight > 0 ? '#ff8c42' : '#4a7fb5', fontWeight: 700 }}>{total > 0 ? `${pct}%` : '—'}</span>
            </span>
            <input type="number" min={0} max={10} step={1} value={weight}
              onChange={e => updateSlot(index, { libraryWeights: { ...slot.libraryWeights, [lib]: Math.max(0, Number(e.target.value)) } })}
              style={inp} />
            <div style={{ height: 4, backgroundColor: '#0a1628', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', backgroundColor: '#1a3a6e' }} />
            </div>
          </label>
        ))}
      </div>
      {total === 0 && (
        <div style={{ color: '#e0a030', fontSize: '0.62rem', marginTop: 6 }}>⚠ No library weight set — this slot will fall back to filler/rescue content.</div>
      )}
    </div>
  )
}

function parseClockToMinutes(value: string): number {
  const parts = String(value).split(':')
  const hours = Number(parts[0]) || 0
  const mins = Number(parts[1]) || 0
  return hours * 60 + mins
}

const SLOT_LIBS = ['tv_shows', 'movies', 'animation', 'fitness'] as const

function labelForLib(lib: string): string {
  if (lib === 'tv_shows') return 'TV'
  return lib.charAt(0).toUpperCase() + lib.slice(1)
}

function slotBounds(slot: SlotConfig): { startMins: number; endMins: number } {
  const startMins = slot.start === 'first' ? 0 : parseClockToMinutes(slot.start)
  const endMins = slot.end === 'until_finished' ? 24 * 60 : parseClockToMinutes(slot.end)
  return { startMins, endMins }
}

// A slot is "filler" when it carries filler windows; otherwise it plays
// programming driven by its library weights. This mirrors the scheduler's
// slotContentType logic so the UI communicates the same intent.
function slotMode(slot: SlotConfig): 'programming' | 'filler' {
  return slot.fillerWindows.length > 0 ? 'filler' : 'programming'
}

function weightBreakdown(slot: SlotConfig): Array<{ lib: string; weight: number; pct: number }> {
  const total = SLOT_LIBS.reduce((sum, lib) => sum + Math.max(0, slot.libraryWeights[lib] || 0), 0)
  return SLOT_LIBS.map((lib) => {
    const weight = Math.max(0, slot.libraryWeights[lib] || 0)
    return { lib, weight, pct: total > 0 ? Math.round((weight / total) * 100) : 0 }
  })
}

function slotSummary(slot: SlotConfig): string {
  if (!slot.enabled) return 'Disabled — this window plays filler'
  if (slotMode(slot) === 'filler') {
    const totalMins = slot.fillerWindows.reduce((sum, w) => sum + w.durationMins, 0)
    const cats = Array.from(new Set(slot.fillerWindows.map((w) => w.category)))
    return `Filler · ${(totalMins / 60).toFixed(1)}h · ${cats.join(', ') || 'unset'}`
  }
  const mix = weightBreakdown(slot).filter((b) => b.weight > 0).map((b) => `${labelForLib(b.lib)} ${b.pct}%`)
  const parts = mix.length ? [mix.join(' · ')] : ['No library weight — will fall back to filler']
  if (slot.strip) parts.push('stripped Mon–Fri')
  if (slot.allowGenres.length) parts.push(`${slot.allowGenres.length} genre${slot.allowGenres.length > 1 ? 's' : ''}`)
  if (slot.openVideo.enabled) parts.push('open ident')
  if (slot.closeVideo.enabled) parts.push('close ident')
  return parts.join(' · ')
}

// Horizontal 24-hour coverage bar. Surfaces gaps (uncovered time that falls back
// to filler) and overlapping windows at a glance.
function SlotTimeline({ slots }: { slots: SlotConfig[] }) {
  const DAY = 24 * 60
  const segments = slots
    .filter((s) => s.enabled)
    .map((s) => ({ ...slotBounds(s), name: s.name, mode: slotMode(s) }))
    .filter((s) => s.endMins > s.startMins)
    .sort((a, b) => a.startMins - b.startMins)

  let covered = 0
  let prevEnd = 0
  let overlap = false
  for (const seg of segments) {
    if (seg.startMins < prevEnd) overlap = true
    covered += Math.max(0, seg.endMins - Math.max(seg.startMins, prevEnd))
    prevEnd = Math.max(prevEnd, seg.endMins)
  }
  const gapMins = Math.max(0, DAY - covered)

  const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: '#4a7fb5', fontSize: '0.65rem', letterSpacing: '0.06em', marginBottom: 6 }}>DAY COVERAGE</div>
      <div style={{ position: 'relative', height: 30, backgroundColor: '#0a1628', border: '1px solid #1e3a5f', borderRadius: 3, overflow: 'hidden' }}>
        {/* Gap track shows through as the bar background */}
        {segments.map((seg, i) => {
          const left = (seg.startMins / DAY) * 100
          const width = ((Math.min(seg.endMins, DAY) - seg.startMins) / DAY) * 100
          const isFiller = seg.mode === 'filler'
          return (
            <div
              key={i}
              title={`${seg.name}: ${fmt(seg.startMins)}–${seg.endMins >= DAY ? '24:00' : fmt(seg.endMins)} (${isFiller ? 'filler' : 'programming'})`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: `${width}%`,
                top: 0,
                bottom: 0,
                backgroundColor: isFiller ? '#33415a' : '#1a3a6e',
                borderRight: '1px solid #060f1e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.55rem',
                color: '#cfe0f5',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
              }}
            >
              {width > 7 ? seg.name : ''}
            </div>
          )
        })}
        {/* Hour gridlines */}
        {[6, 12, 18].map((h) => (
          <div key={h} style={{ position: 'absolute', left: `${(h * 60 / DAY) * 100}%`, top: 0, bottom: 0, width: 1, backgroundColor: 'rgba(74,127,181,0.25)' }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4a7fb5', fontSize: '0.55rem', marginTop: 3 }}>
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <Legend colour="#1a3a6e" label="Programming" />
        <Legend colour="#33415a" label="Filler" />
        <Legend colour="#0a1628" label="Gap → filler" />
        {gapMins > 0 && <span style={{ color: '#e0a030', fontSize: '0.62rem' }}>⚠ {gapMins} min uncovered (falls back to filler)</span>}
        {overlap && <span style={{ color: '#e0a030', fontSize: '0.62rem' }}>⚠ overlapping slots — narrower window wins</span>}
      </div>
    </div>
  )
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#a8c4e0', fontSize: '0.62rem' }}>
      <span style={{ width: 12, height: 12, backgroundColor: colour, border: '1px solid #1e3a5f', display: 'inline-block' }} />
      {label}
    </span>
  )
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
const sel: React.CSSProperties = { ...inp }
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
