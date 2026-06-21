'use client'

import { useEffect, useState } from 'react'
import AdminShell from '@/components/admin/AdminShell'

interface CatalogItem {
  plexKey: string
  title: string
  type: 'movie' | 'show'
  year: number
}

interface HolidaySetting { id: string; name: string; label: string; startMonth: number; startDay: number; endMonth: number; endDay: number; enabled: boolean }

const DEFAULT_HOLIDAY_SETTINGS: HolidaySetting[] = [
  { id: 'christmas', name: 'christmas', label: 'Christmas Day', startMonth: 12, startDay: 25, endMonth: 12, endDay: 25, enabled: true },
  { id: 'christmas_eve', name: 'christmas_eve', label: 'Christmas Eve', startMonth: 12, startDay: 24, endMonth: 12, endDay: 24, enabled: true },
  { id: 'good_friday', name: 'good_friday', label: 'Good Friday', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, enabled: true },
  { id: 'easter', name: 'easter', label: 'Easter Sunday', startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, enabled: true },
  { id: 'halloween', name: 'halloween', label: 'Halloween', startMonth: 10, startDay: 31, endMonth: 10, endDay: 31, enabled: true },
]

export default function CatalogPage() {
  const [holidaySettings, setHolidaySettings] = useState<HolidaySetting[]>(DEFAULT_HOLIDAY_SETTINGS)
  const [blockedItems, setBlockedItems] = useState<CatalogItem[]>([])
  const [blockedKeys, setBlockedKeys] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchType, setSearchType] = useState<'all' | 'movie' | 'show'>('all')
  const [searchResults, setSearchResults] = useState<CatalogItem[]>([])
  const [holidayName, setHolidayName] = useState('christmas')
  const [holidayTaggedItems, setHolidayTaggedItems] = useState<CatalogItem[]>([])
  const [holidayTaggedKeys, setHolidayTaggedKeys] = useState<string[]>([])
  const [msg, setMsg] = useState('')

  const loadBlocked = async (query = '', type: 'all' | 'movie' | 'show' = searchType) => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    params.set('type', type)
    const r = await fetch(`/api/admin/blocked-media?${params.toString()}`)
    const data = await r.json()
    setBlockedItems(data.blockedItems || [])
    setBlockedKeys(data.blockedKeys || [])
    setSearchResults(data.results || [])
  }

  useEffect(() => {
    loadBlocked().catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/admin/holiday-settings')
      .then((r) => (r.ok ? r.json() : { settings: DEFAULT_HOLIDAY_SETTINGS }))
        .then((data) => {
        const settings = Array.isArray(data.settings) && data.settings.length > 0 ? data.settings : DEFAULT_HOLIDAY_SETTINGS
        setHolidaySettings(settings)
        if (!settings.some((setting: HolidaySetting) => setting.name === holidayName)) {
          setHolidayName(settings[0]?.name ?? 'christmas')
        }
      })
      .catch(() => setHolidaySettings(DEFAULT_HOLIDAY_SETTINGS))
  }, [])

  const loadHolidayTags = async (targetHoliday = holidayName, query = '', type: 'all' | 'movie' | 'show' = searchType) => {
    const params = new URLSearchParams()
    params.set('holidayName', targetHoliday)
    if (query) params.set('q', query)
    params.set('type', type)
    const r = await fetch(`/api/admin/catalog/holiday-tags?${params.toString()}`)
    const data = await r.json()
    setHolidayTaggedItems(data.taggedItems || [])
    setHolidayTaggedKeys(data.taggedKeys || [])
    if (query) setSearchResults(data.results || [])
  }

  useEffect(() => {
    loadHolidayTags(holidayName).catch(() => {})
  }, [holidayName])

  const doSearch = async () => {
    const query = searchQuery.trim()
    if (query.length < 2) {
      setMsg('Enter at least 2 characters to search catalog.')
      return
    }
    await Promise.all([
      loadBlocked(query, searchType),
      loadHolidayTags(holidayName, query, searchType),
    ])
  }

  const addBlock = async (plexKey: string) => {
    const r = await fetch('/api/admin/blocked-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plexKey }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMsg(data.error || 'Failed to add blocked item.')
      return
    }
    setBlockedItems(data.blockedItems || [])
    setBlockedKeys((data.blockedItems || []).map((x: CatalogItem) => x.plexKey))
    setMsg('✓ Added to blocked list.')
  }

  const removeBlock = async (plexKey: string) => {
    const r = await fetch('/api/admin/blocked-media', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plexKey }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMsg(data.error || 'Failed to remove blocked item.')
      return
    }
    setBlockedItems(data.blockedItems || [])
    setBlockedKeys((data.blockedItems || []).map((x: CatalogItem) => x.plexKey))
    setMsg('✓ Removed from blocked list.')
  }

  const addHolidayTag = async (plexKey: string) => {
    const r = await fetch('/api/admin/catalog/holiday-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holidayName, plexKey }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMsg(data.error || 'Failed to add holiday tag.')
      return
    }
    setHolidayTaggedItems(data.taggedItems || [])
    setHolidayTaggedKeys((data.taggedItems || []).map((x: CatalogItem) => x.plexKey))
    setMsg(`✓ Tagged for ${holidayLabel}.`)
  }

  const removeHolidayTag = async (plexKey: string) => {
    const r = await fetch('/api/admin/catalog/holiday-tags', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holidayName, plexKey }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      setMsg(data.error || 'Failed to remove holiday tag.')
      return
    }
    setHolidayTaggedItems(data.taggedItems || [])
    setHolidayTaggedKeys((data.taggedItems || []).map((x: CatalogItem) => x.plexKey))
    setMsg(`✓ Removed holiday tag for ${holidayLabel}.`)
  }

  const holidayOptionItems = holidaySettings.length > 0 ? holidaySettings : DEFAULT_HOLIDAY_SETTINGS
  const holidayLabel = holidayOptionItems.find((setting) => setting.name === holidayName)?.label ?? holidayName

  return (
    <AdminShell>
      <h2 style={h2}>Plex Catalog</h2>
      <p style={sub}>Browse synced Plex movies and shows, block titles from scheduling, and tag titles for holiday override priority.</p>

      {msg && <p style={{ color: '#ff6600', fontSize: '0.78rem', margin: '14px 0' }}>{msg}</p>}

      <div style={{ border: '1px solid #1e3a5f', padding: 14, marginBottom: 18, backgroundColor: '#0a1628' }}>
        <h3 style={{ margin: '0 0 8px', color: '#ff6600', fontSize: '0.85rem', letterSpacing: '0.06em' }}>Search Catalog</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search title..." style={{ ...inp, minWidth: 220, flex: 1 }} />
          <select value={searchType} onChange={e => setSearchType(e.target.value as 'all' | 'movie' | 'show')} style={{ ...sel, width: 120 }}>
            <option value="all">All</option>
            <option value="movie">Movies</option>
            <option value="show">Shows</option>
          </select>
          <button onClick={doSearch} style={btn}>Search</button>
          <button onClick={() => loadBlocked()} style={{ ...btn, backgroundColor: '#1a3a6e' }}>Refresh</button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ color: '#4a7fb5', fontSize: '0.72rem' }}>Holiday Tag Target:</span>
          <select value={holidayName} onChange={e => setHolidayName(e.target.value)} style={{ ...sel, width: 180 }}>
            {holidayOptionItems.map((h) => (
              <option key={h.name} value={h.name}>{h.label}</option>
            ))}
          </select>
        </div>

        {searchResults.length > 0 && (
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #0d1f3c' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
                  <th style={{ ...td, fontWeight: 600 }}>Title</th>
                  <th style={{ ...td, fontWeight: 600 }}>Type</th>
                  <th style={{ ...td, fontWeight: 600 }}>Year</th>
                  <th style={{ ...td, fontWeight: 600 }}>Scheduling</th>
                  <th style={{ ...td, fontWeight: 600 }}>Holiday Override</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((item) => {
                  const isBlocked = blockedKeys.includes(item.plexKey)
                  const isHolidayTagged = holidayTaggedKeys.includes(item.plexKey)
                  return (
                    <tr key={item.plexKey} style={{ borderBottom: '1px solid #0d1f3c' }}>
                      <td style={td}>{item.title}</td>
                      <td style={td}>{item.type}</td>
                      <td style={td}>{item.year || '-'}</td>
                      <td style={td}>
                        {isBlocked ? (
                          <button onClick={() => removeBlock(item.plexKey)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Unblock</button>
                        ) : (
                          <button onClick={() => addBlock(item.plexKey)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem' }}>Block</button>
                        )}
                      </td>
                      <td style={td}>
                        {isHolidayTagged ? (
                          <button onClick={() => removeHolidayTag(item.plexKey)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Untag</button>
                        ) : (
                          <button onClick={() => addHolidayTag(item.plexKey)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#1a3a6e' }}>Tag</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ border: '1px solid #1e3a5f', padding: 14, marginBottom: 18, backgroundColor: '#0a1628' }}>
          <h3 style={{ margin: '0 0 8px', color: '#ff6600', fontSize: '0.85rem', letterSpacing: '0.06em' }}>
          Holiday Tagged Media ({holidayLabel})
        </h3>
        <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #0d1f3c' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
                <th style={{ ...td, fontWeight: 600 }}>Title</th>
                <th style={{ ...td, fontWeight: 600 }}>Type</th>
                <th style={{ ...td, fontWeight: 600 }}>Year</th>
                <th style={{ ...td, fontWeight: 600 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {holidayTaggedItems.map((item) => (
                <tr key={`holiday-${item.plexKey}`} style={{ borderBottom: '1px solid #0d1f3c' }}>
                  <td style={td}>{item.title}</td>
                  <td style={td}>{item.type}</td>
                  <td style={td}>{item.year || '-'}</td>
                  <td style={td}><button onClick={() => removeHolidayTag(item.plexKey)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Untag</button></td>
                </tr>
              ))}
              {holidayTaggedItems.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...td, color: '#4a7fb5', fontStyle: 'italic' }}>No tagged titles for this holiday.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ border: '1px solid #1e3a5f', padding: 14, backgroundColor: '#0a1628' }}>
        <h3 style={{ margin: '0 0 8px', color: '#ff6600', fontSize: '0.85rem', letterSpacing: '0.06em' }}>Blocked For Scheduling</h3>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #0d1f3c' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e3a5f', color: '#4a7fb5' }}>
                <th style={{ ...td, fontWeight: 600 }}>Title</th>
                <th style={{ ...td, fontWeight: 600 }}>Type</th>
                <th style={{ ...td, fontWeight: 600 }}>Year</th>
                <th style={{ ...td, fontWeight: 600 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {blockedItems.map((item) => (
                <tr key={`blocked-${item.plexKey}`} style={{ borderBottom: '1px solid #0d1f3c' }}>
                  <td style={td}>{item.title}</td>
                  <td style={td}>{item.type}</td>
                  <td style={td}>{item.year || '-'}</td>
                  <td style={td}><button onClick={() => removeBlock(item.plexKey)} style={{ ...btn, padding: '3px 8px', fontSize: '0.65rem', backgroundColor: '#3d0000' }}>Unblock</button></td>
                </tr>
              ))}
              {blockedItems.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ ...td, color: '#4a7fb5', fontStyle: 'italic' }}>No blocked movies/shows.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  )
}

const h2: React.CSSProperties = { margin: 0, color: '#ff6600', fontSize: '1rem', letterSpacing: '0.08em', fontWeight: 700 }
const sub: React.CSSProperties = { color: '#4a7fb5', fontSize: '0.78rem', margin: '6px 0 0' }
const btn: React.CSSProperties = { backgroundColor: '#ff6600', color: '#fff', border: 'none', padding: '7px 14px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }
const sel: React.CSSProperties = { backgroundColor: '#060f1e', border: '1px solid #1e3a5f', color: '#fff', padding: '7px 10px', fontSize: '0.78rem', width: '100%' }
const inp: React.CSSProperties = { ...sel, boxSizing: 'border-box' as const }
const td: React.CSSProperties  = { padding: '7px 10px', color: '#a8c4e0' }