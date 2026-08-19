'use client'

// UpNextCard
// "Coming up next" broadcast lower-third shown during station breaks and ad
// pods — styled like a 1990s network promo end-slate: full-width strip, flat
// two-tone fill, hard keylines, condensed caps. Rendered live from schedule
// data (FieldStation42 autobump equivalent, no pre-made video assets).

import { useEffect, useState } from 'react'
import type { UpNextInfo } from '@/lib/playback'
import { OSD_FONT_FAMILY } from '@/lib/osd-style'

interface Props {
  upNext: UpNextInfo
  clockOffsetMs: number
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase()
}

export default function UpNextCard({ upNext, clockOffsetMs }: Props) {
  const [nowMs, setNowMs] = useState(() => Date.now() + clockOffsetMs)

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now() + clockOffsetMs), 1000)
    return () => clearInterval(timer)
  }, [clockOffsetMs])

  const untilMs = Math.max(0, upNext.startsAtMs - nowMs)
  const mins = Math.floor(untilMs / 60_000)
  const secs = Math.floor((untilMs % 60_000) / 1000)
  const episodeTag = upNext.seasonNumber != null && upNext.episodeNumber != null
    ? `S${String(upNext.seasonNumber).padStart(2, '0')} E${String(upNext.episodeNumber).padStart(2, '0')}`
    : null

  const accentColour = upNext.premiere ? '#c8102e' : '#d97b16'

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: '10%',
        zIndex: 12,
        display: 'flex',
        alignItems: 'stretch',
        backgroundColor: 'rgba(8, 12, 40, 0.92)',
        borderTop: '2px solid #fff',
        borderBottom: `4px solid ${accentColour}`,
        fontFamily: '"Arial Narrow", "Helvetica Neue Condensed", Arial, sans-serif',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {/* Kicker block */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '10px 22px',
          backgroundColor: accentColour,
          flexShrink: 0,
        }}
      >
        <span style={{ color: '#fff', fontWeight: 900, fontSize: 'clamp(0.8rem, 2vmin, 1.1rem)', letterSpacing: '0.3em', whiteSpace: 'nowrap' }}>
          {upNext.premiere ? '★ PREMIERE' : 'UP NEXT'}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.85)', fontFamily: OSD_FONT_FAMILY, fontWeight: 700, fontSize: 'clamp(0.75rem, 1.8vmin, 1rem)', marginTop: 4 }}>
          {formatClock(upNext.startsAtMs)}
        </span>
      </div>

      {/* Poster (square keyline frame) */}
      {upNext.thumbPath && (
        <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0 8px 16px', flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/plex-art?path=${encodeURIComponent(upNext.thumbPath)}`}
            alt=""
            style={{
              height: 'clamp(48px, 9vmin, 84px)',
              aspectRatio: '2 / 3',
              objectFit: 'cover',
              border: '2px solid #fff',
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      )}

      {/* Programme details */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 18px' }}>
        <div style={{
          color: '#fff',
          fontWeight: 900,
          fontSize: 'clamp(1.1rem, 3.2vmin, 2rem)',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          textShadow: '2px 2px 0 rgba(0,0,0,0.7)',
        }}>
          {upNext.showTitle ?? upNext.title}
        </div>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginTop: 2, minWidth: 0 }}>
          {upNext.showTitle && upNext.title && upNext.title !== upNext.showTitle && (
            <span style={{ color: '#cfd6ff', fontSize: 'clamp(0.8rem, 2vmin, 1.1rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {upNext.title}
            </span>
          )}
          {episodeTag && (
            <span style={{ color: '#8f9bd8', fontSize: 'clamp(0.7rem, 1.7vmin, 0.95rem)', letterSpacing: '0.12em', flexShrink: 0 }}>{episodeTag}</span>
          )}
          {upNext.anniversaryYears != null && (
            <span style={{ color: '#f2c34c', fontSize: 'clamp(0.7rem, 1.7vmin, 0.95rem)', fontStyle: 'italic', flexShrink: 0 }}>
              First aired {upNext.anniversaryYears} year{upNext.anniversaryYears === 1 ? '' : 's'} ago tonight
            </span>
          )}
        </div>
      </div>

      {/* Countdown */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '0 22px', flexShrink: 0, borderLeft: '1px solid rgba(255,255,255,0.25)' }}>
        <span style={{ fontFamily: OSD_FONT_FAMILY, fontWeight: 700, color: '#9fe89f', fontSize: 'clamp(1rem, 2.6vmin, 1.6rem)' }}>
          {mins}:{String(secs).padStart(2, '0')}
        </span>
      </div>
    </div>
  )
}
