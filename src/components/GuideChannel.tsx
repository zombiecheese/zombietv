'use client'

// GuideChannel
// A Prevue-Guide-style scrolling programme listing channel.
// Top half: promo area — auto-populated from /api/guide/promos (top YouTube
// search result for each station's now-airing programme), cycling through
// stations with a listing panel beside the video, always muted. Falls back to
// the configured promo video, then a station clock card.
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

interface PromoItem {
  stationId: string
  stationName: string
  channelNumber: number
  title: string
  videoId: string | null
  nextTitle: string | null
  nextStartMs: number | null
}

const GUIDE_REFRESH_MS = 5 * 60_000
const PROMO_REFRESH_MS = 5 * 60_000
const PROMO_CYCLE_MS = 25_000
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
  const [promos, setPromos] = useState<PromoItem[]>([])
  const [promoIndex, setPromoIndex] = useState(0)
  const musicRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Background music: mounts muted (autoplay-policy safe) and is unmuted in
  // place via the YouTube IFrame API — same pattern as the weather channel.
  // Promo videos stay muted permanently; music is the only audio source.
  useEffect(() => {
    if (!config?.musicVideoId) return

    const post = (func: string, args: unknown[] = []) => {
      musicRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }),
        'https://www.youtube.com',
      )
    }
    const nudge = () => {
      musicRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 'zombietv-guide' }),
        'https://www.youtube.com',
      )
      post('playVideo')
      post('unMute')
      post('setVolume', [100])
    }

    const timers = [400, 1200, 2500, 5000].map((ms) => setTimeout(nudge, ms))
    const retry = setInterval(nudge, 8_000)

    window.addEventListener('pointerdown', nudge, true)
    window.addEventListener('keydown', nudge, true)
    window.addEventListener('touchstart', nudge, true)

    return () => {
      timers.forEach(clearTimeout)
      clearInterval(retry)
      window.removeEventListener('pointerdown', nudge, true)
      window.removeEventListener('keydown', nudge, true)
      window.removeEventListener('touchstart', nudge, true)
    }
  }, [config?.musicVideoId])

  // Auto-populated promos: what's airing on each channel + a matching video.
  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        const res = await fetch('/api/guide/promos')
        if (!res.ok) return
        const data: { promos?: PromoItem[] } = await res.json()
        if (!alive || !Array.isArray(data.promos)) return
        setPromos(data.promos.filter((p) => p.videoId))
      } catch {
        // keep last known promos
      }
    }

    load()
    const timer = setInterval(load, PROMO_REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // Cycle through the promo rotation.
  useEffect(() => {
    if (promos.length < 2) return
    const timer = setInterval(() => setPromoIndex((i) => i + 1), PROMO_CYCLE_MS)
    return () => clearInterval(timer)
  }, [promos.length])

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

  const activePromo = promos.length > 0 ? promos[promoIndex % promos.length] : null
  const promoVideoId = activePromo?.videoId ?? config?.promoVideoId ?? null

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
      {/* Promo area: video box left, now/next listing panel right */}
      <div
        style={{
          height: '42%',
          position: 'relative',
          display: 'flex',
          background: 'linear-gradient(180deg, #2f34a8 0%, #232878 100%)',
          borderBottom: '3px solid #f2a33c',
        }}
      >
        {/* Video box */}
        <div style={{ width: '52%', padding: '2.2% 1.6% 2.2% 2.4%', display: 'flex' }}>
          <div style={{ position: 'relative', flex: 1, background: '#000', border: '3px solid #10123f', boxShadow: '0 4px 16px rgba(0,0,0,0.55)', overflow: 'hidden' }}>
            {promoVideoId ? (
              <iframe
                key={promoVideoId}
                title="guide-promo"
                src={`https://www.youtube.com/embed/${encodeURIComponent(promoVideoId)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(promoVideoId)}&controls=0&modestbranding=1&rel=0&iv_load_policy=3`}
                allow="autoplay; encrypted-media"
                style={{ position: 'absolute', inset: '-18% 0', width: '100%', height: '136%', border: 'none', pointerEvents: 'none' }}
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
                <div style={{ fontSize: '1.6rem', fontWeight: 900, letterSpacing: '0.3em', color: '#f2c34c' }}>ZOMBIE TV</div>
                <div style={{ fontSize: '0.75rem', letterSpacing: '0.4em', color: '#8f9bd8', marginTop: 6 }}>PROGRAMME GUIDE</div>
                <div style={{ fontFamily: 'monospace', fontSize: '1.5rem', color: '#ffe27a', marginTop: 12 }}>{timeLabel}</div>
              </div>
            )}
          </div>
        </div>

        {/* Now/next listing panel */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2.6%',
            padding: '2% 3%',
            textAlign: 'center',
            textShadow: '2px 2px 0 rgba(0,0,0,0.75)',
          }}
        >
          {activePromo ? (
            <>
              <div style={{ color: '#ffe27a', fontSize: 'clamp(1rem, 2.6vmin, 1.7rem)', fontWeight: 900, letterSpacing: '0.14em' }}>
                {activePromo.stationName.toUpperCase()}
              </div>
              <div style={{ color: '#f2c34c', fontSize: 'clamp(1.05rem, 3vmin, 1.9rem)', fontWeight: 900, letterSpacing: '0.1em' }}>
                &ldquo;{activePromo.title.toUpperCase()}&rdquo;
              </div>
              <div style={{ color: '#fff', fontSize: 'clamp(0.85rem, 2.2vmin, 1.4rem)', fontWeight: 800, letterSpacing: '0.08em' }}>
                Now showing
              </div>
              {activePromo.nextTitle && activePromo.nextStartMs && (
                <div style={{ color: '#fff', fontSize: 'clamp(0.8rem, 2vmin, 1.25rem)', fontWeight: 800, letterSpacing: '0.06em' }}>
                  Next showing&nbsp;&nbsp;{fmtCol(activePromo.nextStartMs)}
                </div>
              )}
              <div style={{ color: '#ffe27a', fontSize: 'clamp(0.85rem, 2.2vmin, 1.4rem)', fontWeight: 900, letterSpacing: '0.1em' }}>
                Channel {activePromo.channelNumber}
              </div>
            </>
          ) : (
            <>
              <div style={{ color: '#f2c34c', fontSize: 'clamp(1.2rem, 3.2vmin, 2rem)', fontWeight: 900, letterSpacing: '0.28em' }}>ZOMBIE TV</div>
              <div style={{ color: '#8f9bd8', fontSize: 'clamp(0.7rem, 1.6vmin, 1rem)', letterSpacing: '0.4em' }}>PROGRAMME GUIDE</div>
              <div style={{ fontFamily: 'monospace', fontSize: 'clamp(1.2rem, 3vmin, 1.9rem)', color: '#ffe27a' }}>{timeLabel}</div>
              <div style={{ fontSize: 'clamp(0.65rem, 1.5vmin, 0.9rem)', color: '#b9c2f0', letterSpacing: '0.2em' }}>{dateLabel.toUpperCase()}</div>
            </>
          )}
        </div>
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

      {/* Background music: mounts muted for autoplay, unmuted via IFrame API */}
      {config?.musicVideoId && (
        <iframe
          ref={musicRef}
          title="guide-music"
          src={`https://www.youtube.com/embed/${encodeURIComponent(config.musicVideoId)}?autoplay=1&mute=1&loop=1&playlist=${encodeURIComponent(config.musicVideoId)}&controls=0&enablejsapi=1${typeof window !== 'undefined' ? `&origin=${encodeURIComponent(window.location.origin)}` : ''}`}
          allow="autoplay"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />
      )}
    </div>
  )
}
