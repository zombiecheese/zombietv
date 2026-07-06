'use client'

// GuideChannel
// A Prevue-Guide-style scrolling programme listing channel.
// Top half: promo area (configurable YouTube video, else station clock card).
// Bottom half: auto-scrolling grid of all stations' current + upcoming shows.
// Station rules JSON: rules.guide.{promoVideoId,musicVideoId}.

import { useEffect, useMemo, useRef, useState } from 'react'

export interface GuideChannelConfig {
  promoVideoId?: string | null
  musicVideoId?: string | null
}

interface Props {
  config: GuideChannelConfig | null
}

interface StationRow {
  id: string
  name: string
  colour: string
}

interface GuideEntry {
  title: string
  startMs: number
  endMs: number
}

interface GuideRow {
  station: StationRow
  entries: GuideEntry[]
}

const GUIDE_REFRESH_MS = 5 * 60_000
const WINDOW_MINS = 90

function halfHourFloor(ms: number): number {
  const d = new Date(ms)
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30)
  return d.getTime()
}

export default function GuideChannel({ config }: Props) {
  const [rows, setRows] = useState<GuideRow[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [audioOn, setAudioOn] = useState(false)
  const audioOnRef = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (audioOnRef.current) return
    const unlock = () => { audioOnRef.current = true; setAudioOn(true) }
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  // Load the aggregated guide payload (one request, server-side cached).
  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        const res = await fetch('/api/guide')
        if (!res.ok) return
        const data: { rows?: Array<{ id: string; name: string; colour: string; entries: Array<{ title: string; startMs: number; endMs: number }> }> } = await res.json()
        if (!alive || !Array.isArray(data.rows)) return
        setRows(data.rows.map((row) => ({
          station: { id: row.id, name: row.name, colour: row.colour },
          entries: row.entries,
        })))
      } catch {
        // keep last known rows
      }
    }

    load()
    const timer = setInterval(load, GUIDE_REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  const windowStartMs = halfHourFloor(nowMs)
  const windowEndMs = windowStartMs + WINDOW_MINS * 60_000
  const columns = [0, 30, 60].map((mins) => windowStartMs + mins * 60_000)

  const timeLabel = useMemo(
    () => new Date(nowMs).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }),
    [nowMs],
  )
  const dateLabel = useMemo(
    () => new Date(nowMs).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
    [nowMs],
  )

  // Cell layout: for each station, compute the entries covering the window.
  const gridRows = useMemo(() => {
    return rows.map((row) => {
      const cells: Array<{ title: string; startMs: number; endMs: number; leftPct: number; widthPct: number }> = []
      for (const entry of row.entries) {
        const startMs = Math.max(entry.startMs, windowStartMs)
        const endMs = Math.min(entry.endMs, windowEndMs)
        if (endMs <= startMs) continue
        cells.push({
          title: entry.title,
          startMs: entry.startMs,
          endMs: entry.endMs,
          leftPct: ((startMs - windowStartMs) / (WINDOW_MINS * 60_000)) * 100,
          widthPct: ((endMs - startMs) / (WINDOW_MINS * 60_000)) * 100,
        })
      }
      return { station: row.station, cells }
    })
  }, [rows, windowStartMs, windowEndMs])

  // Duplicate rows for a seamless scroll loop when there are enough channels.
  const scrolling = gridRows.length > 5
  const displayRows = scrolling ? [...gridRows, ...gridRows] : gridRows
  const scrollDurationSecs = Math.max(20, gridRows.length * 6)

  const fmtCol = (ms: number) =>
    new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true })

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#0a0d2e',
        color: '#fff',
        fontFamily: '"Arial Narrow", Arial, Helvetica, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Promo area */}
      <div style={{ height: '42%', position: 'relative', background: '#000', borderBottom: '3px solid #f2a33c' }}>
        {config?.promoVideoId ? (
          <iframe
            title="guide-promo"
            src={`https://www.youtube.com/embed/${encodeURIComponent(config.promoVideoId)}?autoplay=1&mute=${audioOn ? 0 : 1}&loop=1&playlist=${encodeURIComponent(config.promoVideoId)}&controls=0&modestbranding=1&rel=0`}
            allow="autoplay; encrypted-media"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(180deg, #171d5e 0%, #0a0d2e 100%)',
              textShadow: '3px 3px 0 rgba(0,0,0,0.7)',
            }}
          >
            <div style={{ fontSize: '2.4rem', fontWeight: 900, letterSpacing: '0.3em', color: '#f2c34c' }}>ZOMBIE TV</div>
            <div style={{ fontSize: '1rem', letterSpacing: '0.4em', color: '#8f9bd8', marginTop: 6 }}>PROGRAMME GUIDE</div>
            <div style={{ fontFamily: 'monospace', fontSize: '2rem', color: '#ffe27a', marginTop: 18 }}>{timeLabel}</div>
            <div style={{ fontSize: '0.8rem', color: '#b9c2f0', letterSpacing: '0.2em', marginTop: 4 }}>{dateLabel.toUpperCase()}</div>
          </div>
        )}
      </div>

      {/* Time header */}
      <div style={{ display: 'flex', background: 'linear-gradient(180deg, #2c3690 0%, #171d5e 100%)', borderBottom: '2px solid #5a66c0' }}>
        <div style={{ width: '18%', padding: '6px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#ffe27a', fontSize: '0.85rem' }}>
          {timeLabel}
        </div>
        {columns.map((colMs) => (
          <div key={colMs} style={{ flex: 1, padding: '6px 10px', fontWeight: 800, letterSpacing: '0.08em', fontSize: '0.8rem', color: '#f2c34c', borderLeft: '1px solid #3a4390' }}>
            {fmtCol(colMs)}
          </div>
        ))}
      </div>

      {/* Scrolling grid */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0 }}>
        <div
          style={scrolling ? {
            animation: `guide-scroll ${scrollDurationSecs}s linear infinite`,
          } : undefined}
        >
          {displayRows.map((row, rowIdx) => (
            <div key={`${row.station.id}-${rowIdx}`} style={{ display: 'flex', height: 52, borderBottom: '1px solid #23295e' }}>
              <div
                style={{
                  width: '18%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  padding: '0 10px',
                  background: 'linear-gradient(180deg, #1c2260 0%, #12163f 100%)',
                  borderRight: '2px solid #3a4390',
                }}
              >
                <span style={{ color: '#ffe27a', fontWeight: 900, fontSize: '0.85rem', letterSpacing: '0.08em' }}>
                  {row.station.id.toUpperCase()}
                </span>
                <span style={{ color: '#8f9bd8', fontSize: '0.58rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {row.station.name}
                </span>
              </div>
              <div style={{ flex: 1, position: 'relative', background: '#0e123a' }}>
                {row.cells.length === 0 && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', paddingLeft: 12, color: '#4a5390', fontSize: '0.72rem', letterSpacing: '0.1em' }}>
                    — NO LISTING —
                  </div>
                )}
                {row.cells.map((cell, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      top: 4,
                      bottom: 4,
                      left: `${cell.leftPct}%`,
                      width: `calc(${cell.widthPct}% - 3px)`,
                      background: cell.startMs <= nowMs && nowMs < cell.endMs
                        ? 'linear-gradient(180deg, #3a4699 0%, #262f75 100%)'
                        : 'linear-gradient(180deg, #23295e 0%, #191e4a 100%)',
                      border: '1px solid #3a4390',
                      borderRadius: 3,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 8px',
                      overflow: 'hidden',
                    }}
                  >
                    <span style={{ color: '#fff', fontSize: '0.74rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {cell.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <style>{`@keyframes guide-scroll { 0% { transform: translateY(0); } 100% { transform: translateY(-50%); } }`}</style>
      </div>

      {/* Background music (unlocks after first interaction) */}
      {config?.musicVideoId && audioOn && (
        <iframe
          title="guide-music"
          src={`https://www.youtube.com/embed/${encodeURIComponent(config.musicVideoId)}?autoplay=1&loop=1&playlist=${encodeURIComponent(config.musicVideoId)}&controls=0`}
          allow="autoplay"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}
