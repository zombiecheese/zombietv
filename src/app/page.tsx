// Main TV viewer page
// Wires together: VideoPlayer + EPG + NowBar + ChannelChange + usePlayback
// VHS overlay is rendered in layout.tsx — do NOT import it here.

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

import dynamic from 'next/dynamic'
import { usePlayback }    from '@/hooks/usePlayback'

// Heavy components loaded client-side only
const VideoPlayer   = dynamic(() => import('@/components/VideoPlayer'),   { ssr: false })
const EPG           = dynamic(() => import('@/components/EPG'),           { ssr: false })
const NowBar        = dynamic(() => import('@/components/NowBar'),        { ssr: false })
const ChannelChange = dynamic(() => import('@/components/ChannelChange'), { ssr: false })

// ── Layout constants ──────────────────────────────────────────────────────────
const EPG_HEIGHT_PX    = 440   // height of the EPG panel at the bottom (increased to show 8+ stations)
const EPG_BAR_HEIGHT_PX = 38   // compact bar height when EPG is minimized
const NOWBAR_HEIGHT_PX = 36

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [station, setStation]             = useState('zbc')
  const [epgMinimized, setEpgMinimized]   = useState(false)
  const [pendingStation, setPending]      = useState<string | null>(null)
  const [staticActive, setStaticActive]   = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [session, setSession]             = useState<{
    isLoggedIn: boolean
    plexToken: string | null
    plexServerUrl: string | null
  }>({ isLoggedIn: false, plexToken: null, plexServerUrl: null })

  const { state, clockOffsetMs, isLoading } = usePlayback(station, session.isLoggedIn)

  // ── Set mounted flag on client ────────────────────────────────────────────
  useEffect(() => {
    setMounted(true)
  }, [])

  // ── Sync URL params to station state ──────────────────────────────────────
  useEffect(() => {
    if (!mounted) return
    const stationParam = new URLSearchParams(window.location.search).get('station')
    if (stationParam) {
      setStation(stationParam)
    }
  }, [mounted])

  // ── Fetch session on mount ────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.isLoggedIn) {
          setSession({
            isLoggedIn:    true,
            plexToken:     data.plexToken ?? null,
            plexServerUrl: data.plexServerUrl ?? null,
          })
        }
      })
      .catch(() => {})
      .finally(() => setCheckingSession(false))
  }, [])

  // ── Channel switching: fire static burst, then switch ────────────────────
  const handleSelectStation = useCallback((id: string) => {
    if (id === station || staticActive) return
    setPending(id)
    setStaticActive(true)
  }, [station, staticActive])

  const handleStaticComplete = useCallback(() => {
    setStaticActive(false)
    if (pendingStation) {
      setStation(pendingStation)
      setPending(null)
    }
  }, [pendingStation])

  // ── Plex login ───────────────────────────────────────────────────────────
  const handleLoginClick = useCallback(async () => {
    try {
      const res  = await fetch('/api/auth/plex/init', { method: 'POST' })
      const data = await res.json()
      if (data.authUrl) window.location.href = data.authUrl
    } catch { /* ignore */ }
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────
  const epgHeight = epgMinimized ? EPG_BAR_HEIGHT_PX : EPG_HEIGHT_PX
  const nowBarHeight = epgMinimized ? 0 : NOWBAR_HEIGHT_PX  // Hide NowBar when EPG is minimized (buttons are in compact EPG bar)

  return (
    <div style={{
      position:   'fixed',
      inset:      0,
      display:    'flex',
      flexDirection: 'column',
      backgroundColor: '#000',
      fontFamily: 'Arial, sans-serif',
    }}>

      {/* ── Admin link (top-right corner, subtle) ── */}
      <Link
        href="/admin"
        style={{
          position:        'fixed',
          top:             8,
          right:           12,
          zIndex:          300,
          color:           '#1e3a5f',
          fontSize:        '0.6rem',
          letterSpacing:   '0.1em',
          textDecoration:  'none',
        }}
      >
        ADMIN
      </Link>

      {checkingSession ? (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#4a7fb5',
          letterSpacing: '0.15em',
          fontSize: '0.8rem',
          background: 'radial-gradient(circle at 30% 20%, #0b1d36 0%, #050a14 60%, #000 100%)',
        }}>
          CHECKING SESSION…
        </div>
      ) : !session.isLoggedIn ? (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'radial-gradient(circle at 30% 20%, #102a4d 0%, #050a14 55%, #000 100%)',
          padding: 24,
        }}>
          <div style={{
            width: 'min(760px, 100%)',
            border: '1px solid #1e3a5f',
            backgroundColor: 'rgba(8, 16, 30, 0.92)',
            padding: '36px 28px',
            textAlign: 'center',
            boxShadow: '0 0 0 1px rgba(30,58,95,0.2), 0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ color: '#ff6600', fontWeight: 900, letterSpacing: '0.12em', fontSize: '1.5rem', marginBottom: 10 }}>
              ZOMBIE TV
            </div>
            <div style={{ color: '#4a7fb5', letterSpacing: '0.12em', fontSize: '0.72rem', marginBottom: 22 }}>
              1990s AUSTRALIAN BROADCAST SIMULATOR
            </div>
            <div style={{ color: '#a8c4e0', fontSize: '0.92rem', lineHeight: 1.6, maxWidth: 580, margin: '0 auto 24px' }}>
              Sign in with Plex to start the broadcast and sync playback to your server.
              Without an active session, the player and EPG stay offline.
            </div>
            <button
              onClick={handleLoginClick}
              style={{
                backgroundColor: '#ff6600',
                color: '#fff',
                border: 'none',
                padding: '14px 22px',
                fontWeight: 800,
                letterSpacing: '0.1em',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              SIGN IN WITH PLEX
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Video player — fills entire screen (EPG overlays on top) ── */}
          <div style={{
            flex:     1,
            overflow: 'hidden',
            position: 'relative',
            minHeight: 0,
          }}>
            <VideoPlayer
              state={state}
              plexServerUrl={session.plexServerUrl}
              plexToken={session.plexToken}
              clockOffsetMs={clockOffsetMs}
              isLoading={isLoading}
            />
          </div>

          {/* ── EPG panel overlay (on top of video) ── */}
          <div style={{
            position:   'fixed',
            bottom:     nowBarHeight,
            left:       0,
            right:      0,
            height:     epgHeight,
            zIndex:     100,
            borderTop:  '1px solid #1e3a5f',
          }}>
            <EPG
              activeStation={station}
              onSelectStation={handleSelectStation}
              clockOffsetMs={clockOffsetMs}
              compact={epgMinimized}
              onToggleCompact={() => setEpgMinimized((v) => !v)}
            />
          </div>

          {/* ── Now Bar (only when EPG is expanded, buttons are in compact EPG bar when minimized) ── */}
          {!epgMinimized && (
            <NowBar
              state={state}
              clockOffsetMs={clockOffsetMs}
              isLoggedIn={session.isLoggedIn}
              onLoginClick={handleLoginClick}
            />
          )}
        </>
      )}

      {/* ── Channel change static burst ── */}
      <ChannelChange
        active={staticActive}
        onComplete={handleStaticComplete}
      />

    </div>
  )
}
