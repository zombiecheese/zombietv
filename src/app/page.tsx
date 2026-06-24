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

function authReasonMessage(reason: string | null): string {
  if (!reason) return ''
  const map: Record<string, string> = {
    no_remote_server: 'Plex sign-in succeeded, but no remote playback endpoint was found for your server. Enable secure remote access in Plex and try again.',
    pin_not_authed: 'Plex sign-in was not completed. Finish authentication in Plex and try again.',
    missing_pin: 'Plex sign-in session expired. Start sign-in again.',
  }
  return map[reason] || 'Plex sign-in could not be completed. Please try again.'
}

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const [station, setStation]             = useState('zbc')
  const [epgMinimized, setEpgMinimized]   = useState(false)
  const [pendingStation, setPending]      = useState<string | null>(null)
  const [staticActive, setStaticActive]   = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [appName, setAppName] = useState('Zombie TV')
  const [authError, setAuthError] = useState('')
  const [session, setSession]             = useState<{
    isLoggedIn: boolean
    plexToken: string | null
    plexServerUrl: string | null
  }>({ isLoggedIn: false, plexToken: null, plexServerUrl: null })

  const { state, clockOffsetMs, isLoading } = usePlayback(station, session.isLoggedIn)

  const completePlexSignInFromPin = useCallback(async (pinId: string): Promise<boolean> => {
    try {
      const pinNumber = Number(pinId)
      if (!Number.isFinite(pinNumber) || pinNumber <= 0) return false

      const res = await fetch('/api/auth/plex/complete', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ pinID: pinNumber }),
      })

      if (!res.ok) return false
      const data = await res.json().catch(() => ({}))
      return Boolean(data?.ok)
    } catch {
      return false
    }
  }, [])

  // ── Set mounted flag on client ────────────────────────────────────────────
  useEffect(() => {
    setMounted(true)
  }, [])

  // ── Fetch app name ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/app-settings').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.appName) setAppName(d.appName) }).catch(() => {})
  }, [])

  // ── Sync URL params to station state ──────────────────────────────────────
  useEffect(() => {
    if (!mounted) return
    const params = new URLSearchParams(window.location.search)
    const stationParam = params.get('station')
    const authReason = params.get('reason')
    const authStatus = params.get('auth')
    if (authStatus === 'error') {
      setAuthError(authReasonMessage(authReason))
    } else {
      setAuthError('')
    }
    if (stationParam) {
      setStation(stationParam)
    }
  }, [mounted])

  // ── Fetch session on mount ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const probeSession = async () => {
      const pageUrl = new URL(window.location.href)
      const callbackPinId = pageUrl.searchParams.get('pinID')
      const callbackAuthStatus = pageUrl.searchParams.get('auth')
      const shouldTryComplete = callbackAuthStatus === 'success' && Boolean(callbackPinId)

      const delays = [0, 250, 750]
      for (const delay of delays) {
        if (delay > 0) await wait(delay)
        try {
          const res = await fetch('/api/auth/session', {
            credentials: 'include',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache' },
          })
          if (!res.ok) continue
          const data = await res.json()
          if (cancelled) return
          if (data?.isLoggedIn) {
            setSession({
              isLoggedIn:    true,
              plexToken:     data.plexToken ?? null,
              plexServerUrl: data.plexServerUrl ?? null,
            })
            if (callbackPinId || callbackAuthStatus) {
              pageUrl.searchParams.delete('pinID')
              pageUrl.searchParams.delete('auth')
              pageUrl.searchParams.delete('reason')
              window.history.replaceState({}, '', `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`)
            }
            setCheckingSession(false)
            return
          }
        } catch {
          // Retry once the redirect/cookie write settles.
        }
      }

      if (shouldTryComplete && callbackPinId) {
        const completed = await completePlexSignInFromPin(callbackPinId)
        if (completed) {
          try {
            const sessionRes = await fetch('/api/auth/session', {
              credentials: 'include',
              cache: 'no-store',
              headers: { 'Cache-Control': 'no-cache' },
            })
            if (sessionRes.ok) {
              const data = await sessionRes.json()
              if (!cancelled && data?.isLoggedIn) {
                setSession({
                  isLoggedIn: true,
                  plexToken: data.plexToken ?? null,
                  plexServerUrl: data.plexServerUrl ?? null,
                })
              }
            }
          } catch {
            // Keep fallback resilient.
          }
        }

        pageUrl.searchParams.delete('pinID')
        pageUrl.searchParams.delete('auth')
        pageUrl.searchParams.delete('reason')
        if (!cancelled) {
          window.history.replaceState({}, '', `${pageUrl.pathname}${pageUrl.search}${pageUrl.hash}`)
        }
      }

      if (!cancelled) setCheckingSession(false)
    }

    probeSession()
    return () => { cancelled = true }
  }, [completePlexSignInFromPin])

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
      const res  = await fetch('/api/auth/plex/init', { method: 'POST', credentials: 'include', cache: 'no-store' })
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
              {appName.toUpperCase()}
            </div>
            <div style={{ color: '#4a7fb5', letterSpacing: '0.12em', fontSize: '0.72rem', marginBottom: 22 }}>
              1990s AUSTRALIAN BROADCAST SIMULATOR
            </div>
            <div style={{ color: '#a8c4e0', fontSize: '0.92rem', lineHeight: 1.6, maxWidth: 580, margin: '0 auto 24px' }}>
              Sign in with Plex to start the broadcast and sync playback to your server.
              Without an active session, the player and EPG stay offline.
            </div>
            {authError && (
              <div style={{
                border: '1px solid #8b1c1c',
                backgroundColor: 'rgba(70, 12, 12, 0.55)',
                color: '#ffd2d2',
                fontSize: '0.8rem',
                lineHeight: 1.5,
                maxWidth: 620,
                margin: '0 auto 18px',
                padding: '10px 12px',
                textAlign: 'left',
              }}>
                {authError}
              </div>
            )}
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
              controlsBottomOffset={epgMinimized ? 4 : (NOWBAR_HEIGHT_PX + 4)}
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
