'use client'

// NowBar — the bottom status bar
// Shows: station name · current program title · episode info · ad break indicator
// Also displays the live server-synced clock on the right.

import { useState, useEffect } from 'react'
import type { PlaybackState }  from '@/lib/playback'

const DEFAULT_STATIONS: Record<string, { name: string; colour: string }> = {
  stn:   { name: 'STN',  colour: '#2c3e50' },
  zbc:   { name: 'ZBC',  colour: '#8b0000' },
  nnwk:  { name: 'NNWK', colour: '#003366' },
  seven: { name: '7',    colour: '#cc5500' },
  nine:  { name: '9',    colour: '#cc0000' },
  ten:   { name: '10',   colour: '#0066cc' },
}

interface Props {
  state:         PlaybackState | null
  clockOffsetMs: number
  isLoggedIn:    boolean
  onLoginClick:  () => void
  onLogoutClick: () => void
}

export default function NowBar({ state, clockOffsetMs, isLoggedIn, onLoginClick, onLogoutClick }: Props) {
  const [clockStr, setClockStr] = useState('')
  const [stations, setStations] = useState<Record<string, { name: string; colour: string }>>(DEFAULT_STATIONS)

  // Live clock using server-synced time
  useEffect(() => {
    function tick() {
      const now = new Date(Date.now() + clockOffsetMs)
      setClockStr(
        now.toLocaleTimeString('en-AU', {
          hour:   '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        }),
      )
    }
    tick()
    const t = setInterval(tick, 1_000)
    return () => clearInterval(t)
  }, [clockOffsetMs])

  useEffect(() => {
    let alive = true
    fetch('/api/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; branding?: Record<string, unknown> }>) => {
        if (!alive || !Array.isArray(rows) || rows.length === 0) return
        const mapped: Record<string, { name: string; colour: string }> = {}
        for (const row of rows) {
          mapped[row.id] = {
            name: stationBadgeName(row.id),
            colour: typeof row.branding?.colour_theme === 'string' ? row.branding.colour_theme : '#2c3e50',
          }
        }
        setStations((prev) => ({ ...prev, ...mapped }))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  const station    = state ? (stations[state.stationId] ?? { name: state.stationId.toUpperCase(), colour: '#333' }) : null
  const title      = state?.title ?? (state?.showTitle ?? 'Off Air')
  const epInfo     = state?.seasonNumber != null
    ? `S${state.seasonNumber} E${state.episodeNumber}`
    : null

  return (
    <div style={{
      position:        'fixed',
      bottom:          0,
      left:            0,
      right:           0,
      height:          36,
      backgroundColor: '#050d1a',
      borderTop:       '1px solid #1e3a5f',
      display:         'flex',
      alignItems:      'center',
      zIndex:          200,
      fontFamily:      'Arial, sans-serif',
      fontSize:        '0.72rem',
      color:           '#a8c4e0',
      gap:             0,
    }}>

      {/* Station badge */}
      {station && (
        <div style={{
          backgroundColor: station.colour,
          color:           '#fff',
          fontWeight:      900,
          fontSize:        '0.85rem',
          letterSpacing:   '0.05em',
          padding:         '0 14px',
          height:          '100%',
          display:         'flex',
          alignItems:      'center',
          flexShrink:      0,
          minWidth:        52,
          justifyContent:  'center',
        }}>
          {station.name}
        </div>
      )}

      {/* Program info */}
      <div style={{
        flex:        1,
        padding:     '0 14px',
        overflow:    'hidden',
        whiteSpace:  'nowrap',
        textOverflow: 'ellipsis',
        display:     'flex',
        gap:         10,
        alignItems:  'center',
      }}>
        <span style={{ color: '#e8f0fe', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {title}
        </span>
        {epInfo && (
          <span style={{ color: '#4a7fb5', flexShrink: 0 }}>{epInfo}</span>
        )}
        {state?.inAdBreak && (
          <span style={{
            color:           '#ff6600',
            border:          '1px solid #ff6600',
            padding:         '1px 6px',
            fontSize:        '0.6rem',
            letterSpacing:   '0.1em',
            flexShrink:      0,
            animation:       'blink 1.2s step-start infinite',
          }}>
            AD BREAK
          </span>
        )}
      </div>

      {/* Login / user indicator */}
      {!isLoggedIn && (
        <button
          onClick={onLoginClick}
          style={{
            backgroundColor: 'transparent',
            border:          '1px solid #1e3a5f',
            color:           '#4a7fb5',
            padding:         '3px 12px',
            cursor:          'pointer',
            fontSize:        '0.65rem',
            letterSpacing:   '0.08em',
            flexShrink:      0,
            marginRight:     8,
          }}
        >
          SIGN IN WITH PLEX
        </button>
      )}

      {/* Bottom-bar track buttons (always visible, next to the clock) */}
      <div style={{
        display:      'flex',
        alignItems:   'center',
        gap:          6,
        paddingRight: 8,
      }}>
        {isLoggedIn && (
          <button
            type="button"
            title="Sign out of Plex"
            onClick={onLogoutClick}
            style={{
              height:       22,
              minWidth:     70,
              padding:      '0 8px',
              borderRadius: 4,
              border:       '1px solid rgba(255,102,0,0.65)',
              background:   'rgba(255,102,0,0.18)',
              color:        '#fff',
              fontSize:     '0.64rem',
              fontWeight:   700,
              letterSpacing:'0.03em',
              cursor:       'pointer',
            }}
          >
            LOG OUT
          </button>
        )}
        <button
          type="button"
          title="Subtitles"
          onClick={() => window.dispatchEvent(new CustomEvent('zombietv-open-subtitles'))}
          style={{
            height:       22,
            minWidth:     34,
            padding:      '0 8px',
            borderRadius: 4,
            border:       '1px solid rgba(74,127,181,0.9)',
            background:   'rgba(6,20,44,0.88)',
            color:        '#dbe9ff',
            fontSize:     '0.64rem',
            fontWeight:   700,
            letterSpacing:'0.03em',
            cursor:       'pointer',
          }}
        >
          CC
        </button>
        <button
          type="button"
          title="Audio language"
          onClick={() => window.dispatchEvent(new CustomEvent('zombietv-open-audio'))}
          style={{
            height:       22,
            minWidth:     58,
            padding:      '0 8px',
            borderRadius: 4,
            border:       '1px solid rgba(74,127,181,0.9)',
            background:   'rgba(6,20,44,0.88)',
            color:        '#dbe9ff',
            fontSize:     '0.64rem',
            fontWeight:   700,
            letterSpacing:'0.03em',
            cursor:       'pointer',
          }}
        >
          AUDIO
        </button>
      </div>

      {/* Clock */}
      <div style={{
        padding:       '0 14px',
        color:         '#4a7fb5',
        fontFamily:    'monospace',
        fontSize:      '0.8rem',
        letterSpacing: '0.05em',
        flexShrink:    0,
        borderLeft:    '1px solid #1e3a5f',
        height:        '100%',
        display:       'flex',
        alignItems:    'center',
      }}>
        {clockStr}
      </div>

      <style>{`
        @keyframes blink {
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  )
}

function stationBadgeName(id: string): string {
  if (id === 'seven') return '7'
  if (id === 'nine') return '9'
  if (id === 'ten') return '10'
  return id.toUpperCase()
}
