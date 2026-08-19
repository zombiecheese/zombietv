'use client'

// TvOsd — the 1990s television on-screen display.
//   • Big blocky channel digits (top-right) after channel change / digit entry
//   • One-line program banner (station · time · title) that fades out
//   • Green segment volume bar when the volume changes
// All rendered in the shared VCR OSD style with hard black outlines.

import { useEffect, useState } from 'react'
import type { PlaybackState } from '@/lib/playback'
import { OSD_FONT_FAMILY, OSD_GREEN, OSD_WHITE, osdOutline } from '@/lib/osd-style'

interface Props {
  state:          PlaybackState | null
  channelNumber:  number          // 1-based position in the channel order
  stationLabel:   string          // e.g. "SEVEN"
  digitBuffer:    string          // in-progress numeric entry ('' when idle)
  osdVisible:     boolean         // channel digits + banner shown
  volume:         number          // 0–100
  volumeVisible:  boolean
  clockOffsetMs:  number
}

const VOLUME_SEGMENTS = 20

export default function TvOsd({
  state,
  channelNumber,
  stationLabel,
  digitBuffer,
  osdVisible,
  volume,
  volumeVisible,
  clockOffsetMs,
}: Props) {
  const [clock, setClock] = useState('')

  useEffect(() => {
    const tick = () => {
      const now = new Date(Date.now() + clockOffsetMs)
      setClock(now.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase())
    }
    tick()
    const t = setInterval(tick, 1_000)
    return () => clearInterval(t)
  }, [clockOffsetMs])

  const digits = digitBuffer || String(channelNumber)
  const showDigits = osdVisible || Boolean(digitBuffer)
  const title = state?.title ?? state?.showTitle ?? ''
  const epTag = state?.seasonNumber != null && state?.episodeNumber != null
    ? ` S${state.seasonNumber} E${state.episodeNumber}`
    : ''
  const filled = Math.round((Math.max(0, Math.min(100, volume)) / 100) * VOLUME_SEGMENTS)

  return (
    <>
      {/* Channel digits — top-right, title-safe inset */}
      {showDigits && (
        <div style={{
          position: 'fixed',
          top: '6%',
          right: '7%',
          zIndex: 260,
          pointerEvents: 'none',
          fontFamily: OSD_FONT_FAMILY,
          fontWeight: 700,
          fontSize: 'clamp(3rem, 9vmin, 6.5rem)',
          color: OSD_GREEN,
          textShadow: osdOutline(3),
          letterSpacing: '0.1em',
          userSelect: 'none',
        }}>
          {digits}
          {digitBuffer && <span style={{ opacity: 0.55 }}>–</span>}
        </div>
      )}

      {/* Program banner — bottom, fades with the OSD */}
      {osdVisible && !digitBuffer && (
        <div style={{
          position: 'fixed',
          left: '6%',
          right: '6%',
          bottom: '9%',
          zIndex: 255,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'baseline',
          gap: 18,
          fontFamily: OSD_FONT_FAMILY,
          fontWeight: 700,
          userSelect: 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
        }}>
          <span style={{ color: OSD_GREEN, fontSize: 'clamp(1.1rem, 3vmin, 1.9rem)', textShadow: osdOutline(2), flexShrink: 0 }}>
            {stationLabel.toUpperCase()}
          </span>
          <span style={{ color: OSD_WHITE, fontSize: 'clamp(1rem, 2.6vmin, 1.6rem)', textShadow: osdOutline(2), flexShrink: 0 }}>
            {clock}
          </span>
          {title && (
            <span style={{
              color: OSD_WHITE,
              fontSize: 'clamp(1rem, 2.6vmin, 1.6rem)',
              textShadow: osdOutline(2),
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              minWidth: 0,
            }}>
              {title.toUpperCase()}{epTag}
            </span>
          )}
        </div>
      )}

      {/* Volume bar — classic green segments */}
      {volumeVisible && (
        <div style={{
          position: 'fixed',
          left: '6%',
          bottom: '16%',
          zIndex: 260,
          pointerEvents: 'none',
          fontFamily: OSD_FONT_FAMILY,
          fontWeight: 700,
          userSelect: 'none',
        }}>
          <div style={{ color: OSD_GREEN, fontSize: 'clamp(0.9rem, 2.2vmin, 1.3rem)', textShadow: osdOutline(2), marginBottom: 6 }}>
            VOLUME
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            {Array.from({ length: VOLUME_SEGMENTS }, (_, i) => (
              <div
                key={i}
                style={{
                  width: 'clamp(8px, 1.4vmin, 14px)',
                  height: 'clamp(14px, 2.6vmin, 24px)',
                  backgroundColor: i < filled ? OSD_GREEN : 'rgba(0,0,0,0.55)',
                  border: `2px solid ${i < filled ? '#000' : OSD_GREEN}`,
                  boxSizing: 'border-box',
                }}
              />
            ))}
          </div>
        </div>
      )}

      {/* News clock bug — top-left while a live news window airs */}
      {state?.newsLive && (
        <div style={{
          position: 'fixed',
          top: '6%',
          left: '7%',
          zIndex: 250,
          pointerEvents: 'none',
          fontFamily: OSD_FONT_FAMILY,
          fontWeight: 700,
          fontSize: 'clamp(1rem, 2.6vmin, 1.7rem)',
          color: OSD_WHITE,
          textShadow: osdOutline(2),
          letterSpacing: '0.12em',
          userSelect: 'none',
          opacity: 0.85,
        }}>
          {clock}
        </div>
      )}
    </>
  )
}
