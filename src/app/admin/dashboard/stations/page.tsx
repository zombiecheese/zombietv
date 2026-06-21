'use client'

import { useState, useEffect, useCallback } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface StationData {
  id: string; name: string
  rules: { allow_genres: string; deny_genres: string; allow_languages: string; deny_languages: string; ad_policy: { enabled: boolean; break_interval_tv: number; break_interval_movie: number } }
  fillerPools: { ads: string | null; music: string | null; bumpers: string | null }
  holidayOverrides: Record<string, { replace_schedule: boolean; ad_free: boolean; content_priority: string[] }>
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

export default function StationsPage() {
  const [stations, setStations] = useState<StationData[]>([])
  const [selected, setSelected] = useState<StationData | null>(null)
  const [form,     setForm]     = useState<StationData | null>(null)
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

  const select = (s: StationData) => { setSelected(s); setForm(JSON.parse(JSON.stringify(s))); setMsg('') }

  const save = async () => {
    if (!form) return
    const r = await fetch(`/api/admin/stations/${form.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: form.rules, fillerPools: form.fillerPools, holidayOverrides: form.holidayOverrides, branding: form.branding }),
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

  const setRule = (key: string, val: unknown) => setForm(f => f ? { ...f, rules: { ...f.rules, [key]: val } } : f)
  const setAdPolicy = (key: string, val: unknown) => setForm(f => f ? { ...f, rules: { ...f.rules, ad_policy: { ...f.rules.ad_policy, [key]: val } } } : f)
  const setFiller = (key: string, val: string) => setForm(f => f ? { ...f, fillerPools: { ...f.fillerPools, [key]: val || null } } : f)

  return (
    <AdminShell>
      <h2 style={h2}>Station Rules</h2>
      <p style={sub}>Select a station to edit its genre filters, ad policy, filler pool IDs, and holiday behaviours.</p>

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

            <Section title="Content Genres">
              <SearchableRulePicker
                label="Allow genres"
                description="Search synced Plex genres, then add them to this station's allowed list."
                value={form.rules.allow_genres}
                options={catalogOptions.genres}
                emptyMessage="No synced genre options yet. Run a Plex catalog sync to populate this list."
                onChange={(next) => setRule('allow_genres', next)}
              />
              <SearchableRulePicker
                label="Deny genres"
                description="Search synced Plex genres to block them from this station."
                value={form.rules.deny_genres}
                options={catalogOptions.genres}
                emptyMessage="No synced genre options yet. Run a Plex catalog sync to populate this list."
                onChange={(next) => setRule('deny_genres', next)}
              />
              <SearchableRulePicker
                label="Allow languages"
                description="Search derived Plex language metadata and add languages this station should prefer."
                value={form.rules.allow_languages}
                options={catalogOptions.languages}
                emptyMessage="No synced language options yet. Run a Plex catalog sync to populate this list."
                onChange={(next) => setRule('allow_languages', next)}
              />
              <SearchableRulePicker
                label="Deny languages"
                description="Search derived Plex language metadata and block languages for this station."
                value={form.rules.deny_languages}
                options={catalogOptions.languages}
                emptyMessage="No synced language options yet. Run a Plex catalog sync to populate this list."
                onChange={(next) => setRule('deny_languages', next)}
              />
            </Section>

            <Section title="Ad Policy">
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

            <Section title="YouTube Filler Pools">
              {(['ads','music','bumpers'] as const).map(k => (
                <Field key={k} label={`${k.charAt(0).toUpperCase() + k.slice(1)} playlist / video ID`}>
                  <input value={form.fillerPools[k] ?? ''} onChange={e => setFiller(k, e.target.value)} style={inp}
                    placeholder="e.g. PLxxxxx or videoId (leave blank to disable)" />
                </Field>
              ))}
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

            <Section title="Holiday Overrides">
              {(['christmas','christmas_eve','good_friday','easter','halloween'] as const).map(h => {
                const ho = form.holidayOverrides[h] ?? { replace_schedule: true, ad_free: false, content_priority: [] }
                const setPriority = (v: string) => setForm(f => f ? { ...f, holidayOverrides: { ...f.holidayOverrides, [h]: { ...ho, content_priority: parseRuleTokens(v) } } } : f)
                const setHolidayFlag = (k: string, v: boolean) => setForm(f => f ? { ...f, holidayOverrides: { ...f.holidayOverrides, [h]: { ...ho, [k]: v } } } : f)
                return (
                  <div key={h} style={{ backgroundColor: '#060f1e', border: '1px solid #1e3a5f', padding: '12px 16px', marginBottom: 10 }}>
                    <div style={{ color: '#e8f0fe', fontWeight: 700, fontSize: '0.78rem', marginBottom: 8, textTransform: 'uppercase' }}>{h.replace(/_/g,' ')}</div>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 8 }}>
                      <label style={checkLabel}><input type="checkbox" checked={ho.replace_schedule ?? true} onChange={e => setHolidayFlag('replace_schedule', e.target.checked)} /> Replace schedule</label>
                      <label style={checkLabel}><input type="checkbox" checked={ho.ad_free ?? false} onChange={e => setHolidayFlag('ad_free', e.target.checked)} /> Ad-free</label>
                    </div>
                    <SearchableRulePicker
                      label="Content priority genres"
                      description="Search synced Plex genres and add the ones this holiday should prioritize during schedule replacement."
                      value={(ho.content_priority ?? []).join(', ')}
                      options={catalogOptions.genres}
                      emptyMessage="No synced genre options yet. Run a Plex catalog sync to populate this list."
                      onChange={setPriority}
                    />
                  </div>
                )
              })}
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

function parseRuleTokens(value: string): string[] {
  return value
    .split(',')
    .map((item) => normalizeRuleToken(item))
    .filter(Boolean)
}

function formatRuleTokens(values: string[]): string {
  return values.join(', ')
}

function SearchableRulePicker({
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
    <Field label={label}>
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
            placeholder="Search or type a value, then press Enter"
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
            )) : <div style={pickerEmpty}>No matching synced options.</div>}
          </div>
        )}
        <div style={pickerHint}>Saved as comma-separated rule values for compatibility with the existing scheduler.</div>
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
