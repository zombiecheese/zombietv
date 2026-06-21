'use client'

// EPG — Electronic Program Guide
// Classic 1990s Australian TV guide aesthetic:
//   - Dark blue background, white text
//   - All stations as rows, time as columns
//   - 48-hour look-ahead from current server time
//   - NOW indicator (red line + highlight)
//   - Clicking a slot switches the active station
//
// Data is fetched from /api/epg/[stationId] for each station.

import { useState, useEffect, useRef } from 'react'
import type { EPGSlot } from '@/app/api/epg/[stationId]/route'

// ─── Station metadata (mirrors DB-backed station branding defaults) ──────────

const DEFAULT_STATIONS = [
  { id: 'stn',   name: 'STN',   colour: '#2c3e50', label: 'Subtitle TV Network'           },
  { id: 'zbc',   name: 'ZBC',   colour: '#8b0000', label: 'Zombie Cheese Broadcasting'    },
  { id: 'nnwk',  name: 'NNWK',  colour: '#003366', label: 'Nippon Network'                },
  { id: 'seven', name: '7',     colour: '#cc5500', label: 'Seven'                         },
  { id: 'nine',  name: '9',     colour: '#cc0000', label: 'Nine'                          },
  { id: 'ten',   name: '10',    colour: '#0066cc', label: 'Ten'                           },
]

type StationMeta = {
  id: string
  name: string
  colour: string
  label: string
}

// Scale EPG elements based on device resolution for consistent viewing on 1080p, 1440p, 4K, etc.
// Base values are calibrated for 1080p (typical TV viewing); scale upward on higher resolutions
function getEPGScale(): number {
  if (typeof window === 'undefined') return 1
  // Use device pixel ratio up to 2x, then cap to avoid excessive oversizing
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  // Also consider viewport width — bigger screens get bigger text/spacing
  const widthScale = Math.max(1, window.innerWidth / 1920)
  return Math.min(dpr * 0.9 + widthScale * 0.4, 1.8)
}

// Helper to scale font sizes automatically
function scaleFontSize(baseSizeRem: number, scale: number): string {
  return `${(baseSizeRem * scale).toFixed(3)}rem`
}

const SLOT_HOUR_PX_BASE  = 160      // Pixels per hour in the grid (base for 1080p)
const ROW_HEIGHT_PX_BASE = 52       // Fixed row height — scales with resolution
const STATION_COL_PX_BASE = 90
const MINIMIZE_BUTTON_PX_BASE = 82

// Memoize scale calculation to avoid recalc on every render
let lastScale = 1
let lastWidth = 0
function computeScale(): number {
  if (typeof window !== 'undefined' && window.innerWidth !== lastWidth) {
    lastWidth = window.innerWidth
    lastScale = getEPGScale()
  }
  return lastScale
}

const scale = computeScale()
const SLOT_HOUR_PX  = Math.round(SLOT_HOUR_PX_BASE * scale)
const ROW_HEIGHT_PX = Math.round(ROW_HEIGHT_PX_BASE * scale)
const STATION_COL_PX = Math.round(STATION_COL_PX_BASE * scale)
const MINIMIZE_BUTTON_PX = Math.round(MINIMIZE_BUTTON_PX_BASE * scale)

interface Props {
  activeStation:   string
  onSelectStation: (stationId: string) => void
  clockOffsetMs:   number
  compact?:        boolean
  onToggleCompact?: () => void
}

interface StationSlots {
  [stationId: string]: EPGSlot[]
}

export default function EPG({ activeStation, onSelectStation, clockOffsetMs, compact = false, onToggleCompact }: Props) {
  const [stations, setStations]   = useState<StationMeta[]>(DEFAULT_STATIONS)
  const [slots, setSlots]         = useState<StationSlots>({})
  const [nowMs, setNowMs]         = useState(Date.now)
  const [bodyScrollbarPx, setBodyScrollbarPx] = useState(0)
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0)
  // Vertical scroller + one representative viewport width for horizontal math
  const bodyScrollRef             = useRef<HTMLDivElement | null>(null)
  const timelineViewportRef       = useRef<HTMLDivElement | null>(null)
  const didInitTimelineScrollRef  = useRef(false)
  const dragStateRef              = useRef({
    pointerId:      -1,
    startX:         0,
    startY:         0,
    startScrollLeft: 0,
    axisDetermined: false,
    isHorizontal:   false,
    didDrag:        false,
  })

  // Recalculate scale on window resize
  useEffect(() => {
    const handleResize = () => {
      lastWidth = window.innerWidth
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleBodyPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    dragStateRef.current = {
      pointerId:       event.pointerId,
      startX:          event.clientX,
      startY:          event.clientY,
      startScrollLeft: timelineScrollLeft,
      axisDetermined:  false,
      isHorizontal:    false,
      didDrag:         false,
    }
    // Do NOT capture yet — wait until we know the axis
  }

  const handleBodyPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current
    if (ds.pointerId !== event.pointerId) return

    const deltaX = event.clientX - ds.startX
    const deltaY = event.clientY - ds.startY

    if (!ds.axisDetermined) {
      if (Math.abs(deltaX) > Math.abs(deltaY) + 4) {
        ds.axisDetermined = true
        ds.isHorizontal   = true
        event.currentTarget.setPointerCapture(event.pointerId)
      } else if (Math.abs(deltaY) > Math.abs(deltaX) + 4) {
        ds.axisDetermined = true
        ds.isHorizontal   = false
      }
      return
    }

    if (!ds.isHorizontal) return  // let the browser handle vertical natively

    const viewportWidth = timelineViewportRef.current?.clientWidth ?? 0
    const maxSL  = Math.max(0, gridWidthPx - viewportWidth)
    const nextSL = Math.max(0, Math.min(maxSL, ds.startScrollLeft - deltaX))
    if (Math.abs(deltaX) > 4) ds.didDrag = true
    setTimelineScrollLeft(nextSL)
  }

  const handleBodyPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const ds = dragStateRef.current
    if (ds.pointerId !== event.pointerId) return
    if (ds.isHorizontal) event.currentTarget.releasePointerCapture(event.pointerId)
    ds.pointerId      = -1
    ds.axisDetermined = false
    ds.isHorizontal   = false
    setTimeout(() => { ds.didDrag = false }, 0)
  }

  const allowClickAfterDrag = () => !dragStateRef.current.didDrag

  useEffect(() => {
    let alive = true
    fetch('/api/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name: string; branding?: Record<string, unknown> }>) => {
        if (!alive || !Array.isArray(rows) || rows.length === 0) return
        const mapped = rows.map((s) => ({
          id: s.id,
          name: stationBadgeName(s.id),
          colour: typeof s.branding?.colour_theme === 'string' ? s.branding.colour_theme : '#2c3e50',
          label: s.name,
        }))
        setStations(mapped)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  // Update "now" every 30 seconds
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now() + clockOffsetMs), 30_000)
    return () => clearInterval(t)
  }, [clockOffsetMs])

  useEffect(() => {
    const measureScrollbar = () => {
      const el = bodyScrollRef.current
      if (!el) return
      setBodyScrollbarPx(Math.max(0, el.offsetWidth - el.clientWidth))
    }

    measureScrollbar()
    window.addEventListener('resize', measureScrollbar)
    return () => window.removeEventListener('resize', measureScrollbar)
  }, [stations.length])

  // Fetch slots for all stations (48hr window from now)
  useEffect(() => {
    const from = new Date(nowMs)
    from.setMinutes(0, 0, 0)

    Promise.all(
      stations.map(async (s) => {
        try {
          const res = await fetch(
            `/api/epg/${s.id}?from=${from.toISOString()}&hours=48`,
          )
          if (!res.ok) return { id: s.id, slots: [] }
          const data: EPGSlot[] = await res.json()
          return { id: s.id, slots: data }
        } catch {
          return { id: s.id, slots: [] }
        }
      }),
    ).then((results) => {
      const map: StationSlots = {}
      for (const r of results) map[r.id] = r.slots
      setSlots(map)
    })
  }, [nowMs, stations])

  // ── Time axis ─────────────────────────────────────────────────────────────
  const startMs      = nowMs - (nowMs % (60 * 60 * 1000))  // floor to hour
  const nowOffsetPx  = ((nowMs - startMs) / 3_600_000) * SLOT_HOUR_PX
  const totalHours   = 48
  const gridWidthPx  = totalHours * SLOT_HOUR_PX

  const timeLabels = Array.from({ length: totalHours }, (_, i) => {
    const t = new Date(startMs + i * 3_600_000)
    return {
      label:    t.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }),
      offsetPx: i * SLOT_HOUR_PX,
    }
  })

  const activeMeta = stations.find((s) => s.id === activeStation)
  const activeSlots = slots[activeStation] ?? []
  const currentSlot = activeSlots.find((slot) => {
    const start = new Date(slot.startTime).getTime()
    const end = new Date(slot.endTime).getTime()
    return start <= nowMs && end > nowMs
  })
  const nextSlot = activeSlots.find((slot) => new Date(slot.startTime).getTime() > nowMs)

  // Initial guide framing: start at the current hour boundary like the classic TV guide.
  useEffect(() => {
    if (didInitTimelineScrollRef.current) return
    didInitTimelineScrollRef.current = true
    setTimelineScrollLeft(0)
  }, [startMs])

  if (compact) {
    const nowLabel = new Date(nowMs).toLocaleTimeString('en-AU', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        backgroundColor: '#060f1e',
        color: '#a8c4e0',
        fontFamily: 'Arial, sans-serif',
        borderTop: '1px solid #1e3a5f',
        borderBottom: '1px solid #1e3a5f',
      }}>
        <button
          onClick={onToggleCompact}
          style={{
            background: 'transparent',
            border: 'none',
            borderRight: '1px solid #1e3a5f',
            color: '#4a7fb5',
            padding: '0 12px',
            height: '100%',
            letterSpacing: '0.08em',
            fontSize: scaleFontSize(0.65, scale),
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title="Expand guide"
        >
          EXPAND EPG
        </button>

        <div
          onClick={() => onSelectStation(activeStation)}
          style={{
            minWidth: 72,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 900,
            color: '#fff',
            backgroundColor: activeMeta?.colour ?? '#2c3e50',
            borderRight: '1px solid #1e3a5f',
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: scaleFontSize(0.85, scale),
          }}
        >
          {activeMeta?.name ?? activeStation.toUpperCase()}
        </div>

        <div style={{
          flex: 1,
          padding: '0 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          fontSize: scaleFontSize(0.72, scale),
        }}>
          <span style={{ color: '#e8f0fe', fontWeight: 700 }}>
            {currentSlot?.title ?? 'OFF AIR'}
          </span>
          {nextSlot && (
              <span style={{ color: '#4a7fb5', flexShrink: 0, fontSize: scaleFontSize(0.65, scale) }}>
              NEXT {new Date(nextSlot.startTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })} {nextSlot.title}
            </span>
          )}
        </div>

        {/* CC and AUDIO buttons */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingRight: 8,
          paddingLeft: 4,
        }}>
          <button
            type="button"
            title="Subtitles"
            onClick={() => window.dispatchEvent(new CustomEvent('zombietv-open-subtitles'))}
            style={{
              height: 22,
              minWidth: 34,
              padding: '0 8px',
              borderRadius: 4,
              border: '1px solid rgba(74,127,181,0.9)',
              background: 'rgba(6,20,44,0.88)',
              color: '#dbe9ff',
              fontSize: scaleFontSize(0.64, scale),
              fontWeight: 700,
              letterSpacing: '0.03em',
              cursor: 'pointer',
            }}
          >
            CC
          </button>
          <button
            type="button"
            title="Audio language"
            onClick={() => window.dispatchEvent(new CustomEvent('zombietv-open-audio'))}
            style={{
              height: 22,
              minWidth: 58,
              padding: '0 8px',
              borderRadius: 4,
              border: '1px solid rgba(74,127,181,0.9)',
              background: 'rgba(6,20,44,0.88)',
              color: '#dbe9ff',
              fontSize: scaleFontSize(0.64, scale),
              fontWeight: 700,
              letterSpacing: '0.03em',
              cursor: 'pointer',
            }}
          >
            AUDIO
          </button>
        </div>

        {/* Clock */}
        <div style={{
          padding: '0 14px',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          borderLeft: '1px solid #1e3a5f',
          fontFamily: 'monospace',
          color: '#4a7fb5',
          fontSize: scaleFontSize(0.78, scale),
          flexShrink: 0,
        }}>
          {nowLabel}
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display:         'flex',
      flexDirection:   'column',
      height:          '100%',
      backgroundColor: '#0a1628',
      color:           '#fff',
      fontFamily:      'Arial, sans-serif',
      fontSize:        scaleFontSize(0.75, scale),
      overflow:        'hidden',
      userSelect:      'none',
    }}>

      {/* ── Header row: time axis ── */}
      <div style={{ height: 28, borderBottom: '1px solid #1e3a5f', flexShrink: 0, position: 'relative', backgroundColor: '#060f1e' }}>
        {/* Station label column corner */}
        <div style={{
          position:        'absolute',
          left:            0,
          top:             0,
          bottom:          0,
          width:           STATION_COL_PX,
          padding:         '6px 8px',
          backgroundColor: '#060f1e',
          borderRight:     '1px solid #1e3a5f',
          color:           '#4a7fb5',
          fontSize:        scaleFontSize(0.6, scale),
          letterSpacing:   '0.1em',
          boxSizing:       'border-box',
        }}>
          STATION
        </div>

        {/* Time labels — width explicitly matches body viewport minus scrollbar and button */}
        <div
          style={{
            position:       'absolute',
            left:           STATION_COL_PX,
            right:          bodyScrollbarPx,
            top:            0,
            bottom:         0,
            overflow:       'hidden',
          }}
        >
          <div style={{ width: gridWidthPx, position: 'relative', height: '28px', transform: `translateX(-${timelineScrollLeft}px)` }}>
            {timeLabels.map(({ label, offsetPx }) => (
              <div
                key={offsetPx}
                style={{
                  position:    'absolute',
                  left:        offsetPx,
                  top:         0,
                  bottom:      0,
                  width:       SLOT_HOUR_PX,
                  display:     'flex',
                  alignItems:  'center',
                  paddingLeft: '6px',
                  color:       '#4a7fb5',
                  borderLeft:  '1px solid #1e3a5f',
                  fontSize:    scaleFontSize(0.65, scale),
                  letterSpacing: '0.05em',
                }}
              >
                {label}
              </div>
            ))}
            {/* NOW red line in time header */}
            <div style={{
              position:        'absolute',
              left:            nowOffsetPx,
              top:             0,
              bottom:          0,
              width:           2,
              backgroundColor: '#cc0000',
              zIndex:          10,
            }} />
          </div>
        </div>

        <button
          onClick={onToggleCompact}
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: MINIMIZE_BUTTON_PX,
            backgroundColor: '#060f1e',
            color: '#4a7fb5',
            border: 'none',
            borderLeft: '1px solid #1e3a5f',
            padding: '0 10px',
            fontSize: scaleFontSize(0.6, scale),
            letterSpacing: '0.08em',
            cursor: 'pointer',
            zIndex: 20,
          }}
          title="Minimize guide"
        >
          MINIMIZE
        </button>
      </div>

      {/* ── Station rows: native vertical scroll + shared translated timeline ── */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div
          ref={bodyScrollRef}
          onPointerDown={handleBodyPointerDown}
          onPointerMove={handleBodyPointerMove}
          onPointerUp={handleBodyPointerUp}
          style={{
            width:          '100%',
            height:         '100%',
            overflowX:      'hidden',
            overflowY:      'scroll',
            cursor:         'grab',
            touchAction:    'pan-y',
            scrollbarColor: '#35598a #060f1e',
          }}
        >
          <div>
            {stations.map((station) => {
              const stationSlots = slots[station.id] ?? []
              const isActive     = station.id === activeStation
              return (
                <div
                  key={station.id}
                  style={{
                    display:         'flex',
                    height:          ROW_HEIGHT_PX,
                    boxSizing:       'border-box',
                    borderBottom:    '1px solid #1e3a5f',
                  }}
                >
                  {/* Station badge */}
                  <div
                    onClick={() => allowClickAfterDrag() && onSelectStation(station.id)}
                    style={{
                      width:           STATION_COL_PX,
                      flexShrink:      0,
                      boxSizing:       'border-box',
                      display:         'flex',
                      flexDirection:   'column',
                      alignItems:      'center',
                      justifyContent:  'center',
                      cursor:          'pointer',
                      borderRight:     '1px solid #1e3a5f',
                      backgroundColor: isActive ? station.colour : '#060f1e',
                      transition:      'background-color 0.15s',
                      padding:         '4px',
                      gap:             '3px',
                    }}
                  >
                    <span style={{
                      fontWeight:    900,
                      fontSize:      scaleFontSize(1, scale),
                      letterSpacing: '0.05em',
                      color:         '#fff',
                      lineHeight:    1,
                    }}>{station.name}</span>
                    <span style={{
                      fontSize:   scaleFontSize(0.5, scale),
                      color:      isActive ? 'rgba(255,255,255,0.8)' : '#4a7fb5',
                      textAlign:  'center',
                      lineHeight: 1.2,
                    }}>{station.label}</span>
                  </div>

                  {/* Timeline viewport for this station */}
                  <div ref={timelineViewportRef} style={{
                    flex:            1,
                    height:          '100%',
                    overflow:        'hidden',
                    position:        'relative',
                    backgroundColor: isActive ? '#0d1f3c' : 'transparent',
                  }}>
                  <div style={{
                    position:        'relative',
                    width:           gridWidthPx,
                    height:          '100%',
                    flexShrink:      0,
                    transform:       `translateX(-${timelineScrollLeft}px)`,
                  }}>

                  {/* Hour grid lines */}
                  {timeLabels.map(({ offsetPx }) => (
                    <div
                      key={offsetPx}
                      style={{
                        position:        'absolute',
                        left:            offsetPx,
                        top:             0,
                        bottom:          0,
                        width:           1,
                        backgroundColor: '#1e3a5f',
                        zIndex:          0,
                      }}
                    />
                  ))}

                  {/* NOW line */}
                  <div style={{
                    position:        'absolute',
                    left:            nowOffsetPx,
                    top:             0,
                    bottom:          0,
                    width:           2,
                    backgroundColor: '#cc0000',
                    zIndex:          5,
                  }} />

                  {/* Program slots */}
                  {stationSlots.map((slot) => {
                    const slotStartMs  = new Date(slot.startTime).getTime()
                    const slotEndMs    = new Date(slot.endTime).getTime()
                    const leftPx       = ((slotStartMs - startMs) / 3_600_000) * SLOT_HOUR_PX
                    const widthPx      = Math.max(
                      4,
                      ((slotEndMs - slotStartMs) / 3_600_000) * SLOT_HOUR_PX - 2,
                    )
                    const isNow        = slotStartMs <= nowMs && slotEndMs > nowMs
                    const isPast       = slotEndMs <= nowMs
                    const isAdBreak    = slot.inAdBreak && isNow
                    const episodeLabel = slot.seasonNumber != null
                      ? `S${slot.seasonNumber}E${slot.episodeNumber}`
                      : null
                    const dayLabel = new Date(slot.startTime).toLocaleDateString('en-AU', { weekday: 'short' }).toUpperCase()
                    const titleWithEpisode = episodeLabel
                      ? `${slot.title} · ${episodeLabel}`
                      : slot.title

                    return (
                      <div
                        key={slot.id}
                        onClick={() => allowClickAfterDrag() && onSelectStation(station.id)}
                        title={[
                          slot.title,
                          slot.showTitle && `${slot.showTitle}`,
                          slot.seasonNumber != null && `S${slot.seasonNumber} E${slot.episodeNumber}`,
                        ].filter(Boolean).join(' · ')}
                        style={{
                          position:        'absolute',
                          left:            leftPx + 1,
                          top:             4,
                          bottom:          4,
                          width:           widthPx,
                          backgroundColor: isAdBreak
                            ? (isNow ? '#5a3110' : isPast ? '#24160a' : '#40220d')
                            : isNow
                              ? '#1a3a6e'
                              : isPast
                                ? '#0a0f1a'
                                : '#0f2040',
                          border:          isNow
                            ? isAdBreak ? '1px solid #ff9f4d' : '1px solid #4a7fb5'
                            : isAdBreak ? '1px solid #ff6600' : '1px solid #1e3a5f',
                          borderRadius:    2,
                          padding:         '3px 5px',
                          cursor:          'pointer',
                          overflow:        'hidden',
                          whiteSpace:      'nowrap',
                          textOverflow:    'ellipsis',
                          zIndex:          2,
                          transition:      'background-color 0.1s',
                          display:         'flex',
                          flexDirection:   'column',
                          justifyContent:  'center',
                          gap:             '1px',
                        }}
                      >
                        <span style={{
                          fontWeight:   isNow || isAdBreak ? 700 : 400,
                          color:        isAdBreak
                            ? (isPast ? '#ffb06a' : '#fff1e5')
                            : isNow ? '#e8f0fe' : isPast ? '#3a5f8a' : '#a8c4e0',
                          overflow:     'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace:   'nowrap',
                          fontSize:     scaleFontSize(0.7, scale),
                        }}>
                          {titleWithEpisode}
                        </span>
                        {(slot.showTitle || episodeLabel) && widthPx > 60 && (
                          <span style={{
                            color:      '#7ea3cc',
                            fontSize:   scaleFontSize(0.55, scale),
                            overflow:   'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>
                            {slot.showTitle ?? 'Episode'}
                            {episodeLabel && ` · ${dayLabel}`}
                          </span>
                        )}
                      </div>
                    )
                  })}

                  {/* Empty state when no slots scheduled yet */}
                  {stationSlots.length === 0 && (
                    <div style={{
                      position:   'absolute',
                      left:       0,
                      top:        0,
                      bottom:     0,
                      display:    'flex',
                      alignItems: 'center',
                      paddingLeft: 12,
                      color:      '#1e3a5f',
                      fontSize:   scaleFontSize(0.65, scale),
                      fontStyle:  'italic',
                    }}>
                      Schedule not yet generated
                    </div>
                  )}
                  </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <div style={{
        padding:         '6px 12px',
        borderTop:       '1px solid #1e3a5f',
        backgroundColor: '#060f1e',
        display:         'flex',
        gap:             '20px',
        alignItems:      'center',
        fontSize:        scaleFontSize(0.6, scale),
        color:           '#4a7fb5',
        letterSpacing:   '0.08em',
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 10, height: 10, backgroundColor: '#cc0000', display: 'inline-block' }} />
          NOW
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: 10, height: 10, backgroundColor: '#1a3a6e', border: '1px solid #4a7fb5', display: 'inline-block' }} />
          ON AIR
        </span>
        <span style={{ marginLeft: 'auto' }}>
          48HR GUIDE · DRAG LEFT/RIGHT OR CLICK TO TUNE
        </span>
      </div>
    </div>
  )
}

function stationBadgeName(id: string): string {
  if (id === 'seven') return '7'
  if (id === 'nine') return '9'
  if (id === 'ten') return '10'
  return id.toUpperCase()
}
