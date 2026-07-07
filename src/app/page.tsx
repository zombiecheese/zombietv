// Main TV viewer page
// Wires together: VideoPlayer + EPG + NowBar + ChannelChange + usePlayback
// VHS overlay is rendered in layout.tsx — do NOT import it here.

'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'

import dynamic from 'next/dynamic'
import { usePlayback }    from '@/hooks/usePlayback'
import { useVHSSettings } from '@/hooks/useVHSSettings'
import { playTuneBlip }   from '@/lib/tv-audio'

// Heavy components loaded client-side only
const VideoPlayer   = dynamic(() => import('@/components/VideoPlayer'),   { ssr: false })
const EPG           = dynamic(() => import('@/components/EPG'),           { ssr: false })
const NowBar        = dynamic(() => import('@/components/NowBar'),        { ssr: false })
const ChannelChange = dynamic(() => import('@/components/ChannelChange'), { ssr: false })
const TvOsd         = dynamic(() => import('@/components/TvOsd'),         { ssr: false })
const CrtPower      = dynamic(() => import('@/components/CrtPower'),      { ssr: false })

// ── Layout constants ──────────────────────────────────────────────────────────
const EPG_HEIGHT_PX    = 440   // height of the EPG panel at the bottom (increased to show 8+ stations)
const EPG_BAR_HEIGHT_PX = 38   // compact bar height when EPG is minimized
const NOWBAR_HEIGHT_PX = 36
const MOBILE_BREAKPOINT_PX = 900

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
  const [stationOrder, setStationOrder]   = useState<string[]>(['stn', 'zbc', 'nnwk', 'seven', 'nine', 'ten'])
  const [stationNames, setStationNames]   = useState<Record<string, string>>({})
  const [epgMinimized, setEpgMinimized]   = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const [pendingStation, setPending]      = useState<string | null>(null)
  const [staticActive, setStaticActive]   = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [appName, setAppName] = useState('Zombie TV')
  const [authError, setAuthError] = useState('')
  const [session, setSession]             = useState<{
    isLoggedIn: boolean
  }>({ isLoggedIn: false })

  // ── 1990s TV OSD state ─────────────────────────────────────────────
  const [osdActive, setOsdActive]         = useState(true)   // channel digits + banner + NowBar
  const [digitBuffer, setDigitBuffer]     = useState('')     // numeric channel entry
  const [volume, setVolume]               = useState(100)
  const [volumeVisible, setVolumeVisible] = useState(false)
  const osdTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const digitTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { settings: vhsSettings } = useVHSSettings()

  const { state, clockOffsetMs, isLoading } = usePlayback(station, session.isLoggedIn)
  const mobileEpgInitRef = useRef(false)

  // Show the OSD (channel digits, banner, NowBar) for a few seconds.
  const pokeOsd = useCallback((durationMs = 4_000) => {
    setOsdActive(true)
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current)
    osdTimerRef.current = setTimeout(() => setOsdActive(false), durationMs)
  }, [])

  // Restore persisted volume.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('zombietv-volume')
      if (raw === null || raw === '') return // no stored value — keep default (100)
      const stored = Number(raw)
      if (Number.isFinite(stored) && stored >= 0 && stored <= 100) setVolume(stored)
    } catch { /* ignore */ }
  }, [])

  const adjustVolume = useCallback((delta: number) => {
    setVolume((prev) => {
      const next = Math.max(0, Math.min(100, prev + delta))
      try { window.localStorage.setItem('zombietv-volume', String(next)) } catch { /* ignore */ }
      return next
    })
    setVolumeVisible(true)
    if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current)
    volumeTimerRef.current = setTimeout(() => setVolumeVisible(false), 2_000)
  }, [])

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

  // ── Responsive viewer mode for mobile EPG positioning ────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`)

    const applyViewportMode = (matches: boolean) => {
      setIsMobileViewport(matches)
      if (matches && !mobileEpgInitRef.current) {
        // Default to compact guide on mobile so the video remains visible.
        setEpgMinimized(true)
        mobileEpgInitRef.current = true
      }
    }

    applyViewportMode(media.matches)
    const onChange = (event: MediaQueryListEvent) => applyViewportMode(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  // ── Fetch station order for keyboard channel switching ───────────────────
  useEffect(() => {
    let alive = true
    fetch('/api/stations')
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Array<{ id: string; name?: string }>) => {
        if (!alive || !Array.isArray(rows) || rows.length === 0) return
        const ordered = rows
          .map((row) => row.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
        if (ordered.length) setStationOrder(ordered)
        const names: Record<string, string> = {}
        for (const row of rows) {
          if (typeof row.id === 'string') names[row.id] = typeof row.name === 'string' ? row.name : row.id.toUpperCase()
        }
        setStationNames(names)
      })
      .catch(() => {})
    return () => { alive = false }
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

  // ── Channel switching: analog tuning transition, then switch ────────────
  const handleSelectStation = useCallback((id: string) => {
    if (id === station || staticActive) return
    if (vhsSettings.channelChangeSoundEnabled) playTuneBlip()
    setPending(id)
    setStaticActive(true)
  }, [station, staticActive, vhsSettings.channelChangeSoundEnabled])

  const handleStaticComplete = useCallback(() => {
    setStaticActive(false)
    if (pendingStation) {
      setStation(pendingStation)
      setPending(null)
      pokeOsd()
    }
  }, [pendingStation, pokeOsd])

  // ── Plex login ───────────────────────────────────────────────────────────
  const handleLoginClick = useCallback(async () => {
    try {
      const res  = await fetch('/api/auth/plex/init', { method: 'POST', credentials: 'include', cache: 'no-store' })
      const data = await res.json()
      if (data.authUrl) window.location.href = data.authUrl
    } catch { /* ignore */ }
  }, [])

  const handleLogoutClick = useCallback(async () => {
    // CRT power-off animation, then sign out.
    const doLogout = async () => {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'include',
        })
      } finally {
        window.location.assign('/')
      }
    }

    let done = false
    const onDone = () => { if (!done) { done = true; doLogout() } }
    window.addEventListener('zombietv-power-off-done', onDone, { once: true })
    window.dispatchEvent(new CustomEvent('zombietv-power-off'))
    // Safety net if the animation component is not mounted.
    setTimeout(onDone, 900)
  }, [])

  // ── Keyboard: channel up/down, numeric entry, volume ───────────────────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase() ?? ''
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return
      }

      // Channel up/down
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (!stationOrder.length) return
        event.preventDefault()
        const currentIndex = stationOrder.indexOf(station)
        const startIndex = currentIndex >= 0 ? currentIndex : 0
        const delta = event.key === 'ArrowUp' ? -1 : 1
        const nextIndex = (startIndex + delta + stationOrder.length) % stationOrder.length
        handleSelectStation(stationOrder[nextIndex])
        return
      }

      // Volume
      if (event.key === '+' || event.key === '=' ) {
        event.preventDefault()
        adjustVolume(5)
        return
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        adjustVolume(-5)
        return
      }

      // Numeric channel entry (remote-control style, two digits max)
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        setDigitBuffer((prev) => {
          const next = (prev + event.key).slice(0, 2)
          if (digitTimerRef.current) clearTimeout(digitTimerRef.current)

          const commit = (buffer: string) => {
            setDigitBuffer('')
            const channel = Number(buffer)
            if (channel >= 1 && channel <= stationOrder.length) {
              handleSelectStation(stationOrder[channel - 1])
            }
          }

          const maxDigits = String(stationOrder.length).length
          if (next.length >= maxDigits || Number(`${next}0`) > stationOrder.length * 10) {
            // Enough digits to be unambiguous — commit shortly for that
            // "remote acknowledges" feel.
            digitTimerRef.current = setTimeout(() => commit(next), 350)
          } else {
            digitTimerRef.current = setTimeout(() => commit(next), 1_400)
          }
          return next
        })
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [stationOrder, station, handleSelectStation, adjustVolume])

  // ── Render ───────────────────────────────────────────────────────────────
  const epgHeight: number | string = epgMinimized
    ? EPG_BAR_HEIGHT_PX
    : (isMobileViewport ? '56vh' : EPG_HEIGHT_PX)
  const nowBarHeight = (!epgMinimized && !isMobileViewport) ? NOWBAR_HEIGHT_PX : 0
  // Keep the EPG visible above mobile browser UI controls.
  const mobileBottomOffset = isMobileViewport ? (epgMinimized ? 72 : 10) : 0
  const epgBottom: number | string = isMobileViewport ? mobileBottomOffset : nowBarHeight

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
            display:  'flex',
            alignItems: 'stretch',
            justifyContent: 'center',
            backgroundColor: '#000',
          }}>
            {vhsSettings.fourByThreeEnabled && !isMobileViewport ? (
              /* 4:3 tube mode: pillarboxed picture inside a CRT bezel */
              <div style={{
                position: 'relative',
                height: '100%',
                aspectRatio: '4 / 3',
                maxWidth: '100%',
                borderRadius: '2.2% / 3%',
                overflow: 'hidden',
                boxShadow: 'inset 0 0 60px rgba(0,0,0,0.55), 0 0 0 2px #181818, 0 0 0 14px #0c0c0c, 0 0 40px rgba(0,0,0,0.9)',
              }}>
                <VideoPlayer
                  state={state}
                  clockOffsetMs={clockOffsetMs}
                  isLoading={isLoading}
                  volume={volume}
                />
              </div>
            ) : (
              <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                <VideoPlayer
                  state={state}
                  clockOffsetMs={clockOffsetMs}
                  isLoading={isLoading}
                  volume={volume}
                />
              </div>
            )}
          </div>

          {/* ── EPG panel overlay (on top of video) ── */}
          <div style={{
            position:   'fixed',
            bottom:     epgBottom,
            left:       0,
            right:      0,
            height:     epgHeight,
            maxHeight:  isMobileViewport ? 'calc(100vh - env(safe-area-inset-top) - 12px)' : undefined,
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

          {/* ── Now Bar — OSD-style auto-hide (always visible while EPG is expanded) ── */}
          {!isMobileViewport && (
            <NowBar
              state={state}
              clockOffsetMs={clockOffsetMs}
              isLoggedIn={session.isLoggedIn}
              onLoginClick={handleLoginClick}
              onLogoutClick={handleLogoutClick}
              visible={!epgMinimized || osdActive}
            />
          )}

          {/* ── 1990s TV on-screen display ── */}
          <TvOsd
            state={state}
            channelNumber={Math.max(1, stationOrder.indexOf(station) + 1)}
            stationLabel={stationNames[station] ?? station.toUpperCase()}
            digitBuffer={digitBuffer}
            osdVisible={osdActive && epgMinimized}
            volume={volume}
            volumeVisible={volumeVisible}
            clockOffsetMs={clockOffsetMs}
          />

          {/* ── CRT power-on/off ── */}
          <CrtPower />
        </>
      )}

      {/* ── Channel change tuning transition ── */}
      <ChannelChange
        active={staticActive}
        onComplete={handleStaticComplete}
        mode="roll"
      />

    </div>
  )
}
