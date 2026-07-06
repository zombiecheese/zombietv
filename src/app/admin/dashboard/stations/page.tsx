'use client'

import { useState, useEffect, useCallback } from 'react'
import AdminShell from '@/components/admin/AdminShell'
import { parseClockToMinutes } from '@/lib/time'

interface SlotVideo { enabled: boolean; videoId: string }
interface SlotLibraryWeights { tv_shows: number; movies: number; animation: number; fitness: number }
interface FillerWindow {
  durationMins: number  // Must be multiple of 30
  category: string      // 'ads', 'filler', 'music', 'infomercial'
  displayName?: string
  openVideo: SlotVideo
  closeVideo: SlotVideo
  plexShowKey?: string       // optional: pin a specific Plex show to this window
  plexShowTitle?: string
  fillMode?: 'fill' | 'single'
  strip?: boolean
  sequenceStart?: number     // optional: restrict to a fraction of the series (0–1)
  sequenceEnd?: number
}
interface MarathonConfig { chance: number; count: number; hint?: string }
interface SlotConfig {
  key: string
  name: string
  start: string   // 'HH:MM' or 'first'
  end: string     // 'HH:MM' or 'until_finished'
  enabled: boolean
  fillerWindows: FillerWindow[]  // empty = no filler windows
  disabledLibraries: string[]
  openVideo: SlotVideo
  closeVideo: SlotVideo
  newsVideo: SlotVideo       // optional: YouTube live/video source used only for news slots
  libraryWeights: SlotLibraryWeights
  allowGenres: string[]      // empty = any
  strip: boolean             // weeknight strip: Mon–Fri, one series, daily episodes
  breakStrategy: string      // '' = default interspersed | 'standard' | 'center' | 'end'
  scheduleIncrement: string  // '' = classic | '0' continuous | '5'/'15'/'30'/'60'
  preset: string             // named bundle in rules.slot_presets
  marathon?: MarathonConfig  // probabilistic marathon takeover
}
type DayType = 'weekday' | 'weekend'
interface DateOverrideEntry {
  dates: string              // "December 25", "April 23 - April 25", "October", "Q4", "friday"
  dayType?: string           // '' auto | 'weekday' | 'weekend'
  allowGenres?: string[] | string
}
interface StationRules {
  ad_policy: { enabled: boolean; break_interval_tv: number; break_interval_movie: number }
  slot_config?: { weekday: SlotConfig[]; weekend: SlotConfig[] }
  allow_languages?: string[] | string
  deny_languages?: string[] | string
  overnight_closedown?: boolean
  closedown_content?: { type: 'graphic' | 'youtube_video' | 'youtube_playlist'; value: string }
  time_blocks?: unknown
  channel_type?: string      // 'standard' | 'weather' | 'guide' | 'loop' | 'stream' | 'web'
  weather?: { latitude?: number | string; longitude?: number | string; locationName?: string; musicVideoId?: string }
  guide?: { promoVideoId?: string; musicVideoId?: string }
  loop?: { contentId?: string; title?: string }
  stream?: { url?: string; title?: string }
  web?: { url?: string; title?: string }
  schedule_offset?: number   // 0–29: shifts showtime boundaries (e.g. :05/:35)
  date_overrides?: DateOverrideEntry[]
  slot_presets?: Record<string, Partial<SlotConfig>>
}
interface StationData {
  id: string; name: string
  rules: StationRules
  fillerPools?: { ads: string | null; music: string | null; bumpers: string | null }
  holidayOverrides?: Record<string, unknown>
  branding: { colour_theme: string; logo: string }
  updatedAt?: string
}

interface CatalogFilterOption {
  value: string
  count?: number
  label?: string
}

interface CatalogOptionsResponse {
  genres: CatalogFilterOption[]
  languages: CatalogFilterOption[]
  libraries: CatalogFilterOption[]
  collections: CatalogFilterOption[]
}

const SLOT_LIBS = ['tv_shows', 'movies', 'animation', 'fitness'] as const
type SlotLibraryType = typeof SLOT_LIBS[number]

type EditorTab = 'identity' | 'programming' | 'policies' | 'advanced' | 'branding'

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
    disabledLibraries: [],
    openVideo: { enabled: false, videoId: '' },
    closeVideo: { enabled: false, videoId: '' },
    newsVideo: { enabled: false, videoId: '' },
    libraryWeights: { tv_shows: 1, movies: 1, animation: 0, fitness: 0 },
    allowGenres: [],
    strip: false,
    breakStrategy: '',
    scheduleIncrement: '',
    preset: '',
    marathon: undefined,
  }
}

function normalizeDisabledLibraryType(value: unknown): SlotLibraryType | null {
  const raw = normalizeRuleToken(String(value ?? ''))
  if (!raw) return null
  if (raw === 'tv' || raw === 'tvshow' || raw === 'tvshows' || raw === 'tv_shows' || raw === 'tv-shows' || raw === 'shows') return 'tv_shows'
  if (raw === 'movie' || raw === 'movies') return 'movies'
  if (raw === 'animation' || raw === 'anime') return 'animation'
  if (raw === 'fitness' || raw === 'workout') return 'fitness'
  return null
}

function normalizeDisabledLibraryTypes(values: unknown): string[] {
  if (!Array.isArray(values)) return []
  const deduped = new Set<SlotLibraryType>()
  for (const value of values) {
    const normalized = normalizeDisabledLibraryType(value)
    if (normalized) deduped.add(normalized)
  }
  return Array.from(deduped)
}

function mergeSlots(saved: unknown): SlotConfig[] {
  const arr = Array.isArray(saved) ? (saved as Partial<SlotConfig>[]) : []
  return SLOT_TEMPLATE.map((t) => {
    const found = arr.find((s) => s?.key === t.key)
    const base = defaultSlot(t)
    if (!found) return base
    const marathonRaw = (found.marathon ?? null) as MarathonConfig | null
    const marathon = marathonRaw && Number(marathonRaw.chance) > 0 && Number(marathonRaw.count) >= 1
      ? { chance: Math.min(1, Number(marathonRaw.chance)), count: Math.round(Number(marathonRaw.count)), hint: String(marathonRaw.hint ?? '').trim() || undefined }
      : undefined
    return {
      ...base,
      ...found,
      key: t.key, name: t.name, start: t.start, end: t.end,
      openVideo: { ...base.openVideo, ...(found.openVideo ?? {}) },
      closeVideo: { ...base.closeVideo, ...(found.closeVideo ?? {}) },
      newsVideo: { ...base.newsVideo, ...(found.newsVideo ?? {}) },
      libraryWeights: { ...base.libraryWeights, ...(found.libraryWeights ?? {}) },
      fillerWindows: Array.isArray(found.fillerWindows) ? found.fillerWindows : base.fillerWindows,
      disabledLibraries: normalizeDisabledLibraryTypes(found.disabledLibraries),
      allowGenres: Array.isArray(found.allowGenres) ? found.allowGenres : [],
      strip: Boolean(found.strip),
      breakStrategy: typeof found.breakStrategy === 'string' ? found.breakStrategy : '',
      scheduleIncrement: found.scheduleIncrement != null && found.scheduleIncrement !== '' ? String(found.scheduleIncrement) : '',
      preset: typeof found.preset === 'string' ? found.preset : '',
      marathon,
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
        fillerWindows: [{ durationMins: 30, category: o.filler, displayName: '', openVideo: { enabled: false, videoId: '' }, closeVideo: { enabled: false, videoId: '' } }],
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
  const [catalogOptions, setCatalogOptions] = useState<CatalogOptionsResponse>({ genres: [], languages: [], libraries: [], collections: [] })
  const [msg,      setMsg]      = useState('')
  const [newStationId, setNewStationId] = useState('')
  const [newStationName, setNewStationName] = useState('')
  const [showAddChannel, setShowAddChannel] = useState(false)
  const [savedSnapshot, setSavedSnapshot] = useState('')
  const [renameId, setRenameId] = useState('')
  const [renameName, setRenameName] = useState('')
  const [editorTab, setEditorTab] = useState<EditorTab>('programming')
  const [openSlotKey, setOpenSlotKey] = useState<string | null>(null)

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
          libraries: Array.isArray(data.libraries) ? data.libraries : [],
          collections: Array.isArray(data.collections) ? data.collections : [],
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

  const select = (s: StationData, force = false) => {
    if (!force && dirty && !window.confirm('You have unsaved changes. Discard them and switch station?')) return
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
    setRenameId(s.id)
    setRenameName(s.name)
    setDayType('weekday')
    setOpenSlotKey(null)
    setEditorTab((String(clone.rules.channel_type ?? 'standard') || 'standard') === 'standard' ? 'programming' : 'identity')
    setMsg('')
  }

  const save = async () => {
    if (!form) return
    const r = await fetch(`/api/admin/stations/${form.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: form.rules, branding: form.branding, expectedUpdatedAt: form.updatedAt ?? null }),
    })
    const payload = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMsg(`✗ ${payload.error ?? 'Save failed.'}`)
      return
    }
    setMsg('✓ Saved successfully.')
    const saved: StationData = { ...form, updatedAt: payload.updatedAt ?? form.updatedAt }
    setForm(saved)
    setStations(stations.map(s => s.id === saved.id ? saved : s))
    setSavedSnapshot(snapshotOf(saved))
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

  const renameStation = async () => {
    if (!selected) return
    const nextId = renameId.trim().toLowerCase()
    const nextName = renameName.trim()
    if (!nextId || !nextName) { setMsg('✗ Provide both a channel ID and display name.'); return }
    if (nextId === selected.id && nextName === selected.name) { setMsg('No changes to apply.'); return }
    if (dirty && !window.confirm('You have unsaved slot/rule edits that will be discarded by a rename. Continue?')) return
    if (nextId !== selected.id && !window.confirm(`Rename channel ID "${selected.id}" → "${nextId}"? This re-points all of its schedules, episode progress, events and settings.`)) return

    const r = await fetch(`/api/admin/stations/${selected.id}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newId: nextId, newName: nextName }),
    })
    const payload = await r.json().catch(() => ({}))
    if (!r.ok) { setMsg(`✗ ${payload.error ?? 'Could not rename station.'}`); return }

    setMsg('✓ Channel renamed.')
    const list = await fetch('/api/admin/stations').then((res) => res.json()).catch(() => [])
    setStations(Array.isArray(list) ? list : [])
    const updated = Array.isArray(list) ? list.find((s: StationData) => s.id === nextId) : null
    if (updated) select(updated, true)
    else { setSelected(null); setForm(null) }
  }

  const moveStation = async (index: number, dir: -1 | 1) => {
    const next = index + dir
    if (next < 0 || next >= stations.length) return
    const reordered = [...stations]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(next, 0, moved)
    setStations(reordered)
    await fetch('/api/admin/stations/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: reordered.map((s) => s.id) }),
    }).catch(() => {})
  }

  const setAdPolicy = (key: string, val: unknown) => setForm(f => f ? { ...f, rules: { ...f.rules, ad_policy: { ...f.rules.ad_policy, [key]: val } } } : f)
  const setOvernightClosedown = (val: boolean) => setForm(f => f ? { ...f, rules: { ...f.rules, overnight_closedown: val } } : f)
  const setClosedownContent = (val: StationRules['closedown_content']) => setForm(f => f ? { ...f, rules: { ...f.rules, closedown_content: val } } : f)
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

  const isStandard = (String(form?.rules.channel_type ?? 'standard') || 'standard') === 'standard'
  const editorTabs: Array<{ key: EditorTab; label: string }> = [
    { key: 'identity', label: 'Identity & Type' },
    ...(isStandard ? ([
      { key: 'programming' as EditorTab, label: 'Programming' },
      { key: 'policies' as EditorTab, label: 'Policies' },
      { key: 'advanced' as EditorTab, label: 'Advanced' },
    ]) : []),
    { key: 'branding', label: 'Branding' },
  ]
  const activeTab: EditorTab = editorTabs.some((t) => t.key === editorTab) ? editorTab : 'identity'

  return (
    <AdminShell>
      <h2 style={h2}>Station Rules</h2>
      <p style={sub}>Pick a channel, then work through the tabs — identity &amp; type, programming slots, station-wide policies, and advanced scheduling. Filler videos live in Filler Content; holiday behaviour in Holiday Overrides.</p>

      <div style={{ display: 'flex', gap: 20, marginTop: 20, minHeight: 0 }}>
        {/* Station list */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ color: '#4a7fb5', fontSize: '0.6rem', letterSpacing: '0.06em', marginBottom: 6 }}>CHANNELS (▲▼ order — reflected in the viewer EPG)</div>
          {stations.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'stretch' }}>
              <button onClick={() => select(s)} style={{
                display: 'block', flex: 1, textAlign: 'left', padding: '9px 12px',
                backgroundColor: selected?.id === s.id ? '#1a3a6e' : '#0a1628',
                border: '1px solid', borderColor: selected?.id === s.id ? '#4a7fb5' : '#1e3a5f',
                color: '#fff', cursor: 'pointer', fontSize: '0.78rem', letterSpacing: '0.05em', fontWeight: selected?.id === s.id ? 700 : 400,
              }}>
                <span style={{ color: '#4a7fb5', fontSize: '0.6rem' }}>{i + 1}. </span>{s.id.toUpperCase()}<br />
                <span style={{ fontSize: '0.6rem', color: '#4a7fb5', fontWeight: 400 }}>{s.name}</span>
              </button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <button type="button" title="Move up" disabled={i === 0} onClick={() => moveStation(i, -1)}
                  style={{ ...orderBtn, opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? 'not-allowed' : 'pointer' }}>▲</button>
                <button type="button" title="Move down" disabled={i === stations.length - 1} onClick={() => moveStation(i, 1)}
                  style={{ ...orderBtn, opacity: i === stations.length - 1 ? 0.3 : 1, cursor: i === stations.length - 1 ? 'not-allowed' : 'pointer' }}>▼</button>
              </div>
            </div>
          ))}

          {/* Compact add-channel form */}
          <button
            type="button"
            onClick={() => setShowAddChannel((v) => !v)}
            style={{ ...ghostBtn, width: '100%', padding: '9px 0', marginTop: 4 }}
          >
            {showAddChannel ? '− Cancel' : '+ Add Channel'}
          </button>
          {showAddChannel && (
            <div style={{ border: '1px solid #1e3a5f', backgroundColor: '#07111f', padding: 10, marginTop: 6 }}>
              <Field label="Channel ID">
                <input
                  value={newStationId}
                  onChange={e => setNewStationId(e.target.value.replace(/\s+/g, '').toLowerCase())}
                  style={inp}
                  placeholder="e.g. abc2"
                />
              </Field>
              <Field label="Channel Name">
                <input value={newStationName} onChange={e => setNewStationName(e.target.value)} style={inp} placeholder="Display name" />
              </Field>
              <button onClick={createStation} style={{ ...btn, width: '100%', padding: '8px 0' }}>Create</button>
              {!form && msg && <p style={{ color: msg.startsWith('✗') ? '#e05050' : '#4CAF50', fontSize: '0.68rem', margin: '8px 0 0' }}>{msg}</p>}
            </div>
          )}
        </div>

        {/* Editor */}
        {form && (
          <div style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
            {/* Sticky action bar */}
            <div style={stickyBarS}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
                <span style={{ color: '#e8f0fe', fontWeight: 800, fontSize: '0.9rem', letterSpacing: '0.06em' }}>{form.id.toUpperCase()}</span>
                <span style={{ color: '#4a7fb5', fontSize: '0.7rem' }}>{form.name}</span>
                {!isStandard && (
                  <span style={{ fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.05em', padding: '2px 7px', borderRadius: 3, backgroundColor: '#33415a', color: '#cfe0f5', border: '1px solid #1e3a5f' }}>
                    {String(form.rules.channel_type).toUpperCase()}
                  </span>
                )}
                {dirty && <span style={{ color: '#e0a030', fontSize: '0.68rem' }}>● Unsaved changes</span>}
                {msg && <span style={{ color: msg.startsWith('✗') ? '#e05050' : '#4CAF50', fontSize: '0.7rem' }}>{msg}</span>}
              </div>
              <button onClick={save} style={{ ...btn, opacity: dirty ? 1 : 0.55, whiteSpace: 'nowrap' }}>Save Changes</button>
            </div>

            {/* Editor tabs */}
            <div style={tabsRowS}>
              {editorTabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setEditorTab(t.key)}
                  style={{
                    ...tabBtnS,
                    color: activeTab === t.key ? '#fff' : '#4a7fb5',
                    borderBottom: activeTab === t.key ? '2px solid #ff6600' : '2px solid transparent',
                    fontWeight: activeTab === t.key ? 700 : 400,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {activeTab === 'identity' && (<>
            <Section title="Channel Identity">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr auto', gap: 10, alignItems: 'end' }}>
                <Field label="Channel ID">
                  <input value={renameId} onChange={e => setRenameId(e.target.value.replace(/\s+/g, '').toLowerCase())} style={inp} placeholder="lowercase id" />
                </Field>
                <Field label="Display Name">
                  <input value={renameName} onChange={e => setRenameName(e.target.value)} style={inp} placeholder="Display name" />
                </Field>
                <button onClick={renameStation} style={{ ...btn, height: 38, alignSelf: 'end', padding: '0 18px', whiteSpace: 'nowrap', marginBottom: 0 }}>Rename</button>
              </div>
              <p style={{ color: '#4a7fb5', fontSize: '0.68rem', margin: '6px 0 0' }}>
                Changing the ID re-points all of this channel&apos;s schedules, episode progress, events and settings. Rename before making unsaved slot/rule edits.
              </p>
            </Section>

            <ChannelTypeSection form={form} setForm={setForm} />

            <Section title="Danger Zone">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <button onClick={removeStation} style={{ ...btn, backgroundColor: '#8b1c1c' }}>Delete Channel</button>
                <span style={{ color: '#4a7fb5', fontSize: '0.68rem' }}>Removes this channel and all of its schedules, episode progress, events and content links.</span>
              </div>
            </Section>
            </>)}

            {activeTab === 'programming' && isStandard && (<>
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

              <p style={{ color: '#4a7fb5', fontSize: '0.66rem', margin: '0 0 10px' }}>
                Click a slot to expand and edit it. Each slot is either <strong style={{ color: '#a8c4e0' }}>Programming</strong> (catalog content by library mix) or <strong style={{ color: '#a8c4e0' }}>Filler</strong> (curated YouTube windows).
              </p>

              {slots.map((slot, index) => {
                const isOpen = openSlotKey === slot.key
                return (
                <div key={slot.key} style={{ backgroundColor: '#060f1e', border: '1px solid #1e3a5f', marginBottom: 8 }}>
                  <div
                    onClick={() => setOpenSlotKey(isOpen ? null : slot.key)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 14px', cursor: 'pointer', userSelect: 'none' }}
                  >
                    <div>
                      <div>
                        <span style={{ color: '#4a7fb5', fontSize: '0.72rem', marginRight: 8 }}>{isOpen ? '▾' : '▸'}</span>
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
                    <label style={checkLabel} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={slot.enabled} onChange={e => updateSlot(index, { enabled: e.target.checked })} />
                      Enabled
                    </label>
                  </div>

                  {slot.enabled && isOpen && (
                    <div style={{ padding: '0 14px 14px' }}>
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

                          {isNewsSlot(slot) && (
                            <div style={{ border: '1px solid #1e3a5f', padding: 10, marginBottom: 12 }}>
                              <label style={checkLabel}>
                                <input
                                  type="checkbox"
                                  checked={slot.newsVideo.enabled}
                                  onChange={e => updateSlot(index, { newsVideo: { ...slot.newsVideo, enabled: e.target.checked } })}
                                />
                                News live source (YouTube video / stream / playlist)
                              </label>
                              <p style={{ color: '#4a7fb5', fontSize: '0.66rem', margin: '6px 0 0' }}>
                                When set, this news slot plays the configured YouTube source only for this slot window. If unset, this slot falls back to normal programming selection.
                              </p>
                              {slot.newsVideo.enabled && (
                                <input
                                  value={slot.newsVideo.videoId}
                                  onChange={e => updateSlot(index, { newsVideo: { ...slot.newsVideo, videoId: e.target.value } })}
                                  style={{ ...inp, marginTop: 8 }}
                                  placeholder="YouTube video/stream URL or ID"
                                />
                              )}
                            </div>
                          )}

                          <LibraryWeightsEditor slot={slot} index={index} updateSlot={updateSlot} />

                          <label style={{ ...checkLabel, marginBottom: 12 }}>
                            <input type="checkbox" checked={slot.strip} onChange={e => updateSlot(index, { strip: e.target.checked })} />
                            Weeknight strip (Mon–Fri: one series owns this slot, advancing one episode per day)
                          </label>

                          <TokenPicker
                            label="Allow genres / collections / studios / countries"
                            anyLabel="Any content"
                            options={[...catalogOptions.genres, ...catalogOptions.collections]}
                            value={slot.allowGenres}
                            onChange={(next) => updateSlot(index, { allowGenres: next })}
                          />

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12, marginTop: 12 }}>
                            <Field label="Break strategy">
                              <select value={slot.breakStrategy} onChange={e => updateSlot(index, { breakStrategy: e.target.value })} style={sel}>
                                <option value="">Standard (chapter-aware)</option>
                                <option value="center">Center (one mid break)</option>
                                <option value="end">End (no mid-roll breaks)</option>
                              </select>
                            </Field>
                            <Field label="Schedule increment">
                              <select value={slot.scheduleIncrement} onChange={e => updateSlot(index, { scheduleIncrement: e.target.value })} style={sel}>
                                <option value="">Classic (no padding)</option>
                                <option value="0">Continuous (back-to-back)</option>
                                <option value="5">5 min (tight movie timing)</option>
                                <option value="15">15 min</option>
                                <option value="30">30 min (broadcast blocks)</option>
                                <option value="60">60 min</option>
                              </select>
                            </Field>
                            <Field label="Slot preset (optional)">
                              <input value={slot.preset} onChange={e => updateSlot(index, { preset: e.target.value })} style={inp} placeholder="named preset" />
                            </Field>
                          </div>

                          <MarathonEditor slot={slot} index={index} updateSlot={updateSlot} />
                        </>
                      )}
                    </div>
                  )}
                </div>
                )
              })}
            </Section>
            </>)}

            {activeTab === 'policies' && isStandard && (<>
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

              {form.rules.overnight_closedown && (
                <div style={{ marginTop: 12 }}>
                  <Field label="Close-down loop content">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                      <select
                        value={form.rules.closedown_content?.type ?? 'none'}
                        onChange={e => {
                          const t = e.target.value
                          if (t === 'none') setClosedownContent(undefined)
                          else setClosedownContent({ type: t as 'graphic' | 'youtube_video' | 'youtube_playlist', value: form.rules.closedown_content?.value ?? '' })
                        }}
                        style={sel}
                      >
                        <option value="none">Test pattern (default)</option>
                        <option value="graphic">Static graphic (image URL)</option>
                        <option value="youtube_video">YouTube video (looped)</option>
                        <option value="youtube_playlist">YouTube playlist (looped)</option>
                      </select>
                      {form.rules.closedown_content && (
                        <input
                          value={form.rules.closedown_content.value}
                          onChange={e => setClosedownContent({ type: form.rules.closedown_content!.type, value: e.target.value })}
                          style={inp}
                          placeholder={form.rules.closedown_content.type === 'graphic' ? 'https://…/closedown.png' : 'YouTube video / playlist ID or URL'}
                        />
                      )}
                    </div>
                  </Field>
                  <p style={{ color: '#4a7fb5', fontSize: '0.68rem', margin: '4px 0 0' }}>
                    Plays on a loop during the overnight close-down windows until the station opens again.
                  </p>
                </div>
              )}
            </Section>
            </>)}

            {activeTab === 'advanced' && isStandard && (<>
            <Section title="Broadcast Timing (station-wide)">
              <Field label="Showtime offset (minutes past the hour/half-hour)">
                <input
                  type="number"
                  min={0}
                  max={29}
                  value={Number(form.rules.schedule_offset ?? 0)}
                  onChange={e => setForm(f => f ? { ...f, rules: { ...f.rules, schedule_offset: Math.max(0, Math.min(29, Math.round(Number(e.target.value) || 0))) } } : f)}
                  style={{ ...inp, width: 120 }}
                />
              </Field>
              <p style={{ color: '#4a7fb5', fontSize: '0.68rem', margin: '4px 0 0' }}>
                Shifts padded showtime boundaries — e.g. offset 5 gives that classic superstation feel with shows starting at :05 and :35. Applies wherever slots pad to an increment.
              </p>
            </Section>

            <Section title="Date Overrides">
              <DateOverridesEditor
                value={Array.isArray(form.rules.date_overrides) ? form.rules.date_overrides : []}
                onChange={(next) => setForm(f => f ? { ...f, rules: { ...f.rules, date_overrides: next } } : f)}
              />
            </Section>

            <Section title="Reusable Slot Presets (advanced)">
              <SlotPresetsEditor
                value={form.rules.slot_presets ?? {}}
                onChange={(next) => setForm(f => f ? { ...f, rules: { ...f.rules, slot_presets: next } } : f)}
              />
            </Section>

            <Section title="Day Preview (dry run)">
              <DayPreview stationId={form.id} dirty={dirty} />
            </Section>
            </>)}

            {activeTab === 'branding' && (
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
            )}
          </div>
        )}
        {!form && <p style={{ color: '#4a7fb5', fontSize: '0.78rem' }}>Select a channel to edit, or add a new one from the list.</p>}
      </div>
    </AdminShell>
  )
}

function PlexShowPicker({ plexShowKey, plexShowTitle, onSelect, onClear }: {
  plexShowKey?: string
  plexShowTitle?: string
  onSelect: (key: string, title: string) => void
  onClear: () => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ plexKey: string; title: string; year?: number }>>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return }
    let active = true
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/blocked-media?type=show&limit=15&q=${encodeURIComponent(query.trim())}`)
        const data = await r.json().catch(() => ({}))
        if (active) setResults(Array.isArray(data?.results) ? data.results : [])
      } finally {
        if (active) setLoading(false)
      }
    }, 300)
    return () => { active = false; clearTimeout(t) }
  }, [query])

  if (plexShowKey) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#cfe0f5', fontSize: '0.72rem' }}>📺 {plexShowTitle || plexShowKey}</span>
        <button type="button" style={ghostBtn} onClick={onClear}>Clear</button>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <input value={query} onChange={e => { setQuery(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} style={inp} placeholder="Search Plex shows…" />
      {open && query.trim().length >= 2 && (
        <div style={{ ...suggestionsWrap, marginTop: 6 }}>
          {loading
            ? <div style={pickerEmpty}>Searching…</div>
            : results.length
              ? results.map(r => (
                <button key={r.plexKey} type="button" style={suggestionBtn} onClick={() => { onSelect(r.plexKey, r.title); setQuery(''); setOpen(false) }}>
                  <span>{r.title}{r.year ? ` (${r.year})` : ''}</span>
                </button>
              ))
              : <div style={pickerEmpty}>No matching shows.</div>}
        </div>
      )}
    </div>
  )
}

function FillerWindowsBuilder({ slot, index, updateSlot }: { slot: SlotConfig; index: number; updateSlot: (idx: number, patch: Partial<SlotConfig>) => void }) {
  const FILLER_CATEGORIES = ['ads', 'filler', 'music', 'infomercial'] as const
  const slotDurationMins = (() => {
    const start = slot.start === 'first' ? 0 : (parseClockToMinutes(slot.start) ?? 0)
    const end = slot.end === 'until_finished' ? 24 * 60 : (parseClockToMinutes(slot.end) ?? 24 * 60)
    return Math.max(0, end - start)
  })()
  
  const totalFillerMins = slot.fillerWindows.reduce((sum, w) => sum + w.durationMins, 0)
  const canAddMore = totalFillerMins < slotDurationMins
  
  const addWindow = () => {
    if (!canAddMore) return
    const newWindow: FillerWindow = {
      durationMins: 30,
      category: 'music',
      displayName: '',
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
                  {Array.from({ length: Math.max(1, Math.floor(slotDurationMins / 30)) }, (_, i) => (i + 1) * 30).map(d => (
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
            <Field label="EPG display name (optional)">
              <input
                value={window.displayName ?? ''}
                onChange={e => updateWindow(windowIndex, { displayName: e.target.value })}
                style={inp}
                placeholder="Shown in EPG for this filler window"
              />
            </Field>
            <button onClick={() => removeWindow(windowIndex)} style={{ ...btn, padding: '6px 10px', fontSize: '0.65rem', backgroundColor: '#3d0000', height: 'fit-content' }}>Remove</button>
          </div>

          <div style={{ marginBottom: 8 }}>
            <div style={{ color: '#4a7fb5', fontSize: '0.62rem', letterSpacing: '0.06em', marginBottom: 6 }}>PINNED PLEX SHOW (optional — plays &amp; advances a specific series)</div>
            <PlexShowPicker
              plexShowKey={window.plexShowKey}
              plexShowTitle={window.plexShowTitle}
              onSelect={(key, title) => updateWindow(windowIndex, { plexShowKey: key, plexShowTitle: title, fillMode: window.fillMode ?? 'fill' })}
              onClear={() => updateWindow(windowIndex, { plexShowKey: undefined, plexShowTitle: undefined })}
            />
            {window.plexShowKey && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#a8c4e0', fontSize: '0.68rem' }}>
                  Fill mode
                  <select value={window.fillMode ?? 'fill'} onChange={e => updateWindow(windowIndex, { fillMode: e.target.value as 'fill' | 'single' })} style={{ ...sel, width: 'auto' }}>
                    <option value="fill">Fill window with episodes</option>
                    <option value="single">Single episode, then filler</option>
                  </select>
                </label>
                <label style={checkLabel}>
                  <input type="checkbox" checked={Boolean(window.strip)} onChange={e => updateWindow(windowIndex, { strip: e.target.checked })} />
                  Weeknight strip (daily)
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#a8c4e0', fontSize: '0.68rem' }} title="Restrict this window to a fraction of the series — e.g. 0–75% daytime, 75–100% primetime. The window loops within its range.">
                  Series range %
                  <input
                    type="number" min={0} max={100}
                    value={window.sequenceStart != null ? Math.round(window.sequenceStart * 100) : 0}
                    onChange={e => {
                      const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)))
                      updateWindow(windowIndex, { sequenceStart: v > 0 ? v / 100 : undefined })
                    }}
                    style={{ ...inp, width: 64 }}
                  />
                  –
                  <input
                    type="number" min={0} max={100}
                    value={window.sequenceEnd != null ? Math.round(window.sequenceEnd * 100) : 100}
                    onChange={e => {
                      const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)))
                      updateWindow(windowIndex, { sequenceEnd: v < 100 ? v / 100 : undefined })
                    }}
                    style={{ ...inp, width: 64 }}
                  />
                </label>
              </div>
            )}
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
        : [{ durationMins: 30, category: 'music', displayName: '', openVideo: { enabled: false, videoId: '' }, closeVideo: { enabled: false, videoId: '' } }],
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
  const disabledSet = new Set(slot.disabledLibraries)

  const setDisabledLibrary = (lib: SlotLibraryType, checked: boolean) => {
    const next = new Set(slot.disabledLibraries)
    if (checked) next.add(lib)
    else next.delete(lib)
    updateSlot(index, { disabledLibraries: Array.from(next) })
  }

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
            <label style={{ ...checkLabel, fontSize: '0.66rem' }}>
              <input
                type="checkbox"
                checked={disabledSet.has(lib)}
                onChange={(e) => setDisabledLibrary(lib as SlotLibraryType, e.target.checked)}
              />
              Disable this library type in this slot
            </label>
          </label>
        ))}
      </div>
      {total === 0 && (
        <div style={{ color: '#e0a030', fontSize: '0.62rem', marginTop: 6 }}>⚠ No library weight set — this slot will fall back to filler/rescue content.</div>
      )}
    </div>
  )
}

function labelForLib(lib: string): string {
  if (lib === 'tv_shows') return 'TV'
  return lib.charAt(0).toUpperCase() + lib.slice(1)
}

function slotBounds(slot: SlotConfig): { startMins: number; endMins: number } {
  const startMins = slot.start === 'first' ? 0 : (parseClockToMinutes(slot.start) ?? 0)
  const endMins = slot.end === 'until_finished' ? 24 * 60 : (parseClockToMinutes(slot.end) ?? 24 * 60)
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
    const pinned = slot.fillerWindows.filter((w) => w.plexShowKey).length
    const pinnedNote = pinned ? ` · ${pinned} pinned show${pinned > 1 ? 's' : ''}` : ''
    return `Filler · ${(totalMins / 60).toFixed(1)}h · ${cats.join(', ') || 'unset'}${pinnedNote}`
  }
  const mix = weightBreakdown(slot).filter((b) => b.weight > 0).map((b) => `${labelForLib(b.lib)} ${b.pct}%`)
  const parts = mix.length ? [mix.join(' · ')] : ['No library weight — will fall back to filler']
  if (slot.strip) parts.push('stripped Mon–Fri')
  if (isNewsSlot(slot) && slot.newsVideo.enabled && slot.newsVideo.videoId.trim()) parts.push('news live source')
  if (slot.allowGenres.length) parts.push(`${slot.allowGenres.length} genre${slot.allowGenres.length > 1 ? 's' : ''}`)
  if (slot.disabledLibraries.length) parts.push(`${slot.disabledLibraries.length} library exclusion${slot.disabledLibraries.length > 1 ? 's' : ''}`)
  if (slot.openVideo.enabled) parts.push('open ident')
  if (slot.closeVideo.enabled) parts.push('close ident')
  return parts.join(' · ')
}

function isNewsSlot(slot: SlotConfig): boolean {
  const key = String(slot.key ?? '').toLowerCase()
  const name = String(slot.name ?? '').toLowerCase()
  return key.includes('news') || name.includes('news')
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

// ─── Channel type editor ──────────────────────────────────────────────────────
// Non-standard channel types bypass the scheduler entirely: the viewer renders
// a dedicated surface (weather / guide) or plays the configured source directly
// (loop / stream / web).

const CHANNEL_TYPES: Array<{ value: string; label: string; note: string }> = [
  { value: 'standard', label: 'Standard (scheduled broadcast)', note: 'Normal Plex-programmed station using the slots below.' },
  { value: 'weather', label: 'Weather Centre', note: '90s local-on-the-8s style continuous weather channel (Open-Meteo, no API key).' },
  { value: 'guide', label: 'Programme Guide', note: 'Prevue-style scrolling listings channel with an optional promo video.' },
  { value: 'loop', label: 'Loop', note: 'Continuously loops a YouTube video or playlist.' },
  { value: 'stream', label: 'Live Stream', note: 'Plays an external HLS (.m3u8) or direct video stream URL.' },
  { value: 'web', label: 'Web Page', note: 'Embeds a web page as the channel (diagnostics, dashboards, novelty pages).' },
]

function ChannelTypeSection({ form, setForm }: {
  form: StationData
  setForm: React.Dispatch<React.SetStateAction<StationData | null>>
}) {
  const type = String(form.rules.channel_type ?? 'standard') || 'standard'
  const setType = (val: string) => setForm(f => f ? { ...f, rules: { ...f.rules, channel_type: val } } : f)
  const setCfg = (key: 'weather' | 'guide' | 'loop' | 'stream' | 'web', patch: Record<string, unknown>) =>
    setForm(f => f ? { ...f, rules: { ...f.rules, [key]: { ...((f.rules[key] as Record<string, unknown>) ?? {}), ...patch } } } : f)

  const active = CHANNEL_TYPES.find((t) => t.value === type) ?? CHANNEL_TYPES[0]

  return (
    <Section title="Channel Type">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12, alignItems: 'start' }}>
        <Field label="Type">
          <select value={type} onChange={e => setType(e.target.value)} style={sel}>
            {CHANNEL_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <p style={{ color: '#4a7fb5', fontSize: '0.7rem', margin: '18px 0 0' }}>{active.note}</p>
      </div>

      {type === 'weather' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr 1.5fr', gap: 10 }}>
          <Field label="Latitude">
            <input value={String(form.rules.weather?.latitude ?? '')} onChange={e => setCfg('weather', { latitude: e.target.value })} style={inp} placeholder="-33.87" />
          </Field>
          <Field label="Longitude">
            <input value={String(form.rules.weather?.longitude ?? '')} onChange={e => setCfg('weather', { longitude: e.target.value })} style={inp} placeholder="151.21" />
          </Field>
          <Field label="Location name (on-screen)">
            <input value={String(form.rules.weather?.locationName ?? '')} onChange={e => setCfg('weather', { locationName: e.target.value })} style={inp} placeholder="Sydney" />
          </Field>
          <Field label="Background music (YouTube ID, optional)">
            <input value={String(form.rules.weather?.musicVideoId ?? '')} onChange={e => setCfg('weather', { musicVideoId: e.target.value })} style={inp} placeholder="smooth jazz loop" />
          </Field>
        </div>
      )}

      {type === 'guide' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Promo video (YouTube ID, optional — top half of the screen)">
            <input value={String(form.rules.guide?.promoVideoId ?? '')} onChange={e => setCfg('guide', { promoVideoId: e.target.value })} style={inp} />
          </Field>
          <Field label="Background music (YouTube ID, optional)">
            <input value={String(form.rules.guide?.musicVideoId ?? '')} onChange={e => setCfg('guide', { musicVideoId: e.target.value })} style={inp} />
          </Field>
        </div>
      )}

      {type === 'loop' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="YouTube video or playlist ID (loops continuously)">
            <input value={String(form.rules.loop?.contentId ?? '')} onChange={e => setCfg('loop', { contentId: e.target.value })} style={inp} placeholder="PLxxxx or video ID" />
          </Field>
          <Field label="EPG title">
            <input value={String(form.rules.loop?.title ?? '')} onChange={e => setCfg('loop', { title: e.target.value })} style={inp} placeholder="Continuous Programming" />
          </Field>
        </div>
      )}

      {type === 'stream' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Stream URL (HLS .m3u8 or direct media URL)">
            <input value={String(form.rules.stream?.url ?? '')} onChange={e => setCfg('stream', { url: e.target.value })} style={inp} placeholder="https://…/stream.m3u8" />
          </Field>
          <Field label="EPG title">
            <input value={String(form.rules.stream?.title ?? '')} onChange={e => setCfg('stream', { title: e.target.value })} style={inp} placeholder="Live Stream" />
          </Field>
        </div>
      )}

      {type === 'web' && (
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
          <Field label="Page URL">
            <input value={String(form.rules.web?.url ?? '')} onChange={e => setCfg('web', { url: e.target.value })} style={inp} placeholder="https://example.com/page" />
          </Field>
          <Field label="EPG title">
            <input value={String(form.rules.web?.title ?? '')} onChange={e => setCfg('web', { title: e.target.value })} style={inp} placeholder="Web Channel" />
          </Field>
        </div>
      )}

      {type !== 'standard' && (
        <p style={{ color: '#e0a030', fontSize: '0.68rem', margin: '8px 0 0' }}>
          Programming slots, ad policy and schedule generation are disabled for this channel type.
        </p>
      )}
    </Section>
  )
}

// ─── Marathon editor ──────────────────────────────────────────────────────────

function MarathonEditor({ slot, index, updateSlot }: {
  slot: SlotConfig
  index: number
  updateSlot: (idx: number, patch: Partial<SlotConfig>) => void
}) {
  const m = slot.marathon
  return (
    <div style={{ border: '1px solid #1e3a5f', padding: 10, marginBottom: 12 }}>
      <label style={checkLabel}>
        <input
          type="checkbox"
          checked={Boolean(m)}
          onChange={e => updateSlot(index, { marathon: e.target.checked ? { chance: 0.2, count: 4 } : undefined })}
        />
        Random marathon — this window can be taken over by back-to-back episodes of one series
      </label>
      {m && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 10, marginTop: 10 }}>
          <Field label="Chance (%)">
            <input
              type="number" min={1} max={100}
              value={Math.round(m.chance * 100)}
              onChange={e => {
                const pct = Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 0)))
                updateSlot(index, { marathon: { ...m, chance: pct / 100 } })
              }}
              style={inp}
            />
          </Field>
          <Field label="Length (hours)">
            <input
              type="number" min={1} max={12}
              value={m.count}
              onChange={e => updateSlot(index, { marathon: { ...m, count: Math.max(1, Math.min(12, Math.round(Number(e.target.value) || 1))) } })}
              style={inp}
            />
          </Field>
          <Field label={'Season hint (optional: "October", "Q4", "October 15 - October 31", "friday")'}>
            <input
              value={m.hint ?? ''}
              onChange={e => updateSlot(index, { marathon: { ...m, hint: e.target.value || undefined } })}
              style={inp}
              placeholder="always eligible"
            />
          </Field>
        </div>
      )}
    </div>
  )
}

// ─── Date overrides editor ────────────────────────────────────────────────────

function DateOverridesEditor({ value, onChange }: {
  value: DateOverrideEntry[]
  onChange: (next: DateOverrideEntry[]) => void
}) {
  const update = (i: number, patch: Partial<DateOverrideEntry>) =>
    onChange(value.map((entry, idx) => idx === i ? { ...entry, ...patch } : entry))
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i))
  const add = () => onChange([...value, { dates: '', dayType: '', allowGenres: [] }])

  const genresOf = (entry: DateOverrideEntry): string =>
    Array.isArray(entry.allowGenres) ? entry.allowGenres.join(', ') : String(entry.allowGenres ?? '')

  return (
    <div>
      <p style={{ color: '#4a7fb5', fontSize: '0.72rem', margin: '0 0 10px' }}>
        Take over the schedule on specific calendar dates — holiday marathons, one-off events, seasonal takeovers.
        Dates accept <code>December 25</code>, <code>April 23 - April 25</code> (ranges may wrap the year), a month name, <code>Q1</code>–<code>Q4</code>, or a weekday.
        The genre filter re-points every programming slot for that date (e.g. <code>christmas, family</code>).
      </p>
      {value.map((entry, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1.6fr auto', gap: 10, alignItems: 'end', marginBottom: 8, border: '1px solid #1e3a5f', padding: 10 }}>
          <Field label="Date(s)">
            <input value={entry.dates} onChange={e => update(i, { dates: e.target.value })} style={inp} placeholder="December 25" />
          </Field>
          <Field label="Slot lineup">
            <select value={entry.dayType ?? ''} onChange={e => update(i, { dayType: e.target.value })} style={sel}>
              <option value="">Automatic (normal day)</option>
              <option value="weekday">Use weekday lineup</option>
              <option value="weekend">Use weekend lineup</option>
            </select>
          </Field>
          <Field label="Genre takeover (comma list, optional)">
            <input
              value={genresOf(entry)}
              onChange={e => update(i, { allowGenres: e.target.value.split(',').map(g => g.trim().toLowerCase()).filter(Boolean) })}
              style={inp}
              placeholder="christmas, family"
            />
          </Field>
          <button type="button" onClick={() => remove(i)} style={{ ...btn, backgroundColor: '#3d0000', height: 38 }}>Remove</button>
        </div>
      ))}
      <button type="button" onClick={add} style={{ ...ghostBtn, padding: '8px 14px', height: 'auto' }}>+ Add date override</button>
    </div>
  )
}

// ─── Slot presets editor ─────────────────────────────────────────────────────
// Structured form for the common preset fields, with an advanced JSON mode for
// anything else (bump videos, marathon bundles, filler windows…).

function SlotPresetsEditor({ value, onChange }: {
  value: Record<string, Partial<SlotConfig>>
  onChange: (next: Record<string, Partial<SlotConfig>>) => void
}) {
  const [jsonMode, setJsonMode] = useState(false)
  const [newName, setNewName] = useState('')
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2))
  const [error, setError] = useState('')
  const [appliedMsg, setAppliedMsg] = useState('')

  useEffect(() => {
    setText(JSON.stringify(value ?? {}, null, 2))
    setError('')
    setAppliedMsg('')
  }, [value])

  const entries = Object.entries(value ?? {})

  const updatePreset = (name: string, patch: Partial<SlotConfig>) =>
    onChange({ ...value, [name]: { ...(value[name] ?? {}), ...patch } })

  const removePreset = (name: string) => {
    const next = { ...value }
    delete next[name]
    onChange(next)
  }

  const addPreset = () => {
    const name = newName.trim().toLowerCase().replace(/\s+/g, '_')
    if (!name || value[name]) return
    onChange({ ...value, [name]: {} })
    setNewName('')
  }

  const applyJson = () => {
    try {
      const parsed = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Presets must be a JSON object mapping preset names to slot settings.')
        return
      }
      setError('')
      setAppliedMsg('✓ Presets applied — Save Station Config to keep them.')
      onChange(parsed as Record<string, Partial<SlotConfig>>)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <p style={{ color: '#4a7fb5', fontSize: '0.72rem', margin: 0 }}>
          Define named setting bundles once, then reference them from any slot&apos;s <em>Slot preset</em> field. Preset values win over the slot&apos;s own settings.
        </p>
        <button type="button" onClick={() => setJsonMode((v) => !v)} style={{ ...ghostBtn, padding: '5px 10px', fontSize: '0.66rem' }}>
          {jsonMode ? 'Form editor' : 'Advanced JSON'}
        </button>
      </div>

      {!jsonMode && (
        <>
          {entries.length === 0 && (
            <p style={{ color: '#4a7fb5', fontSize: '0.7rem', fontStyle: 'italic' }}>No presets defined yet.</p>
          )}
          {entries.map(([name, preset]) => (
            <div key={name} style={{ border: '1px solid #1e3a5f', backgroundColor: '#07111f', padding: 10, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#e8f0fe', fontWeight: 700, fontSize: '0.78rem', fontFamily: 'monospace' }}>{name}</span>
                <button type="button" onClick={() => removePreset(name)} style={{ ...btn, padding: '3px 10px', fontSize: '0.62rem', backgroundColor: '#3d0000' }}>Remove</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr auto', gap: 10, alignItems: 'end' }}>
                <Field label="Break strategy">
                  <select
                    value={String(preset.breakStrategy ?? '')}
                    onChange={e => updatePreset(name, { breakStrategy: e.target.value })}
                    style={sel}
                  >
                    <option value="">(unset)</option>
                    <option value="standard">Standard (chapter-aware)</option>
                    <option value="center">Center</option>
                    <option value="end">End</option>
                  </select>
                </Field>
                <Field label="Schedule increment">
                  <select
                    value={preset.scheduleIncrement != null ? String(preset.scheduleIncrement) : ''}
                    onChange={e => updatePreset(name, { scheduleIncrement: e.target.value })}
                    style={sel}
                  >
                    <option value="">(unset)</option>
                    <option value="0">Continuous</option>
                    <option value="5">5 min</option>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="60">60 min</option>
                  </select>
                </Field>
                <Field label="Allow genres (comma list)">
                  <input
                    value={Array.isArray(preset.allowGenres) ? preset.allowGenres.join(', ') : ''}
                    onChange={e => updatePreset(name, { allowGenres: e.target.value.split(',').map(g => g.trim().toLowerCase()).filter(Boolean) })}
                    style={inp}
                    placeholder="(unset)"
                  />
                </Field>
                <label style={{ ...checkLabel, marginBottom: 10, whiteSpace: 'nowrap' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(preset.strip)}
                    onChange={e => updatePreset(name, { strip: e.target.checked })}
                  />
                  Strip
                </label>
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
            <Field label="New preset name">
              <input value={newName} onChange={e => setNewName(e.target.value)} style={{ ...inp, width: 220 }} placeholder="kids_block" onKeyDown={e => { if (e.key === 'Enter') addPreset() }} />
            </Field>
            <button type="button" onClick={addPreset} style={{ ...ghostBtn, padding: '9px 14px' }}>+ Add preset</button>
          </div>
        </>
      )}

      {jsonMode && (
        <>
          <p style={{ color: '#4a7fb5', fontSize: '0.68rem', margin: '0 0 8px' }}>
            Full preset power: any slot property is allowed (e.g. <code>openVideo</code>, <code>marathon</code>, <code>fillerWindows</code>).
          </p>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setAppliedMsg('') }}
            spellCheck={false}
            style={{ ...inp, fontFamily: 'monospace', fontSize: '0.72rem', minHeight: 120, resize: 'vertical', width: '100%' }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <button type="button" onClick={applyJson} style={{ ...ghostBtn, padding: '8px 14px', height: 'auto' }}>Apply presets</button>
            {error && <span style={{ color: '#e05050', fontSize: '0.7rem' }}>✗ {error}</span>}
            {appliedMsg && <span style={{ color: '#4CAF50', fontSize: '0.7rem' }}>{appliedMsg}</span>}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Day preview (dry run) ────────────────────────────────────────────────

interface DayPreviewPayload {
  date: string
  dayName: string
  isWeekend: boolean
  holiday: string | null
  channelType: string
  dateOverrideApplied: boolean
  scheduleOffsetMins: number
  blocks: Array<{
    name: string
    start: string
    end: string
    contentType: string
    allowGenres: string[]
    breakStrategy: string | null
    scheduleIncrement: number | null
    strip: boolean
    fillerWindows: number
    marathon: { chance: number; count: number; hint?: string; wouldTrigger: boolean } | null
  }>
}

function DayPreview({ stationId, dirty }: { stationId: string; dirty: boolean }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [preview, setPreview] = useState<DayPreviewPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch(`/api/admin/stations/${encodeURIComponent(stationId)}/preview?date=${encodeURIComponent(date)}`)
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { setError(data?.error ?? 'Preview failed.'); setPreview(null); return }
      setPreview(data as DayPreviewPayload)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p style={{ color: '#4a7fb5', fontSize: '0.72rem', margin: '0 0 10px' }}>
        Resolve what this channel&apos;s lineup would look like on a chosen date — including date overrides, holiday detection and marathon outcomes — without generating anything. Marathon rolls are deterministic, so this matches what real generation would produce.
        {dirty && <span style={{ color: '#e0a030' }}> Save first — the preview reads the last saved configuration.</span>}
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', marginBottom: 12 }}>
        <Field label="Broadcast date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, width: 180 }} />
        </Field>
        <button type="button" onClick={run} disabled={loading} style={{ ...btn, height: 38, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Resolving…' : 'Preview Day'}
        </button>
      </div>
      {error && <p style={{ color: '#e05050', fontSize: '0.72rem' }}>✗ {error}</p>}
      {preview && (
        <div style={{ border: '1px solid #1e3a5f', backgroundColor: '#07111f', padding: 12 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10, color: '#a8c4e0', fontSize: '0.72rem' }}>
            <span><strong style={{ color: '#e8f0fe' }}>{preview.dayName.toUpperCase()}</strong> ({preview.isWeekend ? 'weekend lineup' : 'weekday lineup'})</span>
            {preview.holiday && <span style={{ color: '#f2c34c' }}>🎄 Holiday: {preview.holiday}</span>}
            {preview.dateOverrideApplied && <span style={{ color: '#f2c34c' }}>📅 Date override applies</span>}
            {preview.scheduleOffsetMins > 0 && <span>Showtime offset: :{String(preview.scheduleOffsetMins).padStart(2, '0')}</span>}
            {preview.channelType !== 'standard' && <span style={{ color: '#e0a030' }}>Non-standard channel ({preview.channelType}) — no scheduled lineup</span>}
          </div>
          {preview.blocks.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'baseline', padding: '5px 0', borderTop: i > 0 ? '1px solid #0d1f3c' : 'none', fontSize: '0.72rem', flexWrap: 'wrap' }}>
              <span style={{ color: '#4a7fb5', fontFamily: 'monospace', minWidth: 96 }}>{b.start}–{b.end}</span>
              <span style={{ color: '#e8f0fe', fontWeight: 700, minWidth: 130 }}>{b.name}</span>
              <span style={{ color: '#88a8cc' }}>{b.contentType}</span>
              {b.marathon?.wouldTrigger && (
                <span style={{ color: '#0a1628', backgroundColor: '#f2a33c', fontWeight: 800, padding: '1px 8px', borderRadius: 3, fontSize: '0.62rem' }}>
                  MARATHON ×{b.marathon.count}h
                </span>
              )}
              {b.marathon && !b.marathon.wouldTrigger && (
                <span style={{ color: '#4a7fb5', fontSize: '0.62rem' }}>marathon roll: no ({Math.round(b.marathon.chance * 100)}%)</span>
              )}
              {b.strip && <span style={{ color: '#88a8cc', fontSize: '0.62rem' }}>strip</span>}
              {b.breakStrategy && <span style={{ color: '#88a8cc', fontSize: '0.62rem' }}>breaks: {b.breakStrategy}</span>}
              {b.scheduleIncrement != null && <span style={{ color: '#88a8cc', fontSize: '0.62rem' }}>inc: {b.scheduleIncrement === 0 ? 'continuous' : `${b.scheduleIncrement}m`}</span>}
              {b.fillerWindows > 0 && <span style={{ color: '#88a8cc', fontSize: '0.62rem' }}>{b.fillerWindows} filler window{b.fillerWindows > 1 ? 's' : ''}</span>}
              {b.allowGenres.length > 0 && <span style={{ color: '#6a86a8', fontSize: '0.62rem' }}>{b.allowGenres.join(', ')}</span>}
            </div>
          ))}
          {preview.blocks.length === 0 && preview.channelType === 'standard' && (
            <p style={{ color: '#e0a030', fontSize: '0.72rem', margin: 0 }}>No slot configuration — the engine day-part template will be used as-is.</p>
          )}
        </div>
      )}
    </div>
  )
}

function TokenPicker({
  label,
  anyLabel,
  value,
  options,
  normalizeValue,
  onChange,
}: {
  label: string
  anyLabel: string
  value: string[]
  options: CatalogFilterOption[]
  normalizeValue?: (rawValue: string) => string
  onChange: (next: string[]) => void
}) {
  const [query, setQuery] = useState('')
  const normalize = normalizeValue ?? normalizeRuleToken
  const isAny = value.length === 0
  const selectedSet = new Set(value)
  const filtered = options
    .filter((option) => !selectedSet.has(option.value))
    .filter((option) => option.value.includes(normalize(query)))
    .slice(0, 18)

  const addValue = (rawValue: string) => {
    const normalized = normalize(rawValue)
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
                <span>{option.label || option.value}</span>
                <span style={suggestionCount}>{option.count ?? ''}</span>
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
const orderBtn: React.CSSProperties = { flex: 1, width: 24, backgroundColor: '#0f223c', border: '1px solid #1e3a5f', color: '#dbe9f8', fontSize: '0.6rem', lineHeight: 1, padding: 0 }
const suggestionsWrap: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }
const suggestionBtn: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, backgroundColor: '#0a1628', border: '1px solid #1e3a5f', color: '#e8f0fe', padding: '8px 10px', fontSize: '0.72rem', cursor: 'pointer', textAlign: 'left' as const }
const suggestionCount: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.68rem' }
const pickerEmpty: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.72rem' }
const stickyBarS: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: 20,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14,
  backgroundColor: '#0a1628', border: '1px solid #1e3a5f',
  padding: '10px 14px', marginBottom: 0,
}
const tabsRowS: React.CSSProperties = {
  position: 'sticky', top: 57, zIndex: 19,
  display: 'flex', gap: 2, flexWrap: 'wrap',
  backgroundColor: '#060f1e', borderBottom: '1px solid #1e3a5f',
  padding: '6px 4px 0', marginBottom: 18,
}
const tabBtnS: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  padding: '8px 14px', fontSize: '0.74rem', letterSpacing: '0.06em',
}
