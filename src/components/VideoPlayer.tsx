'use client'

// VideoPlayer
// Handles all playback for a station:
//   - Plex content   → HTML5 <video> fed by our same-origin Plex stream proxy
//   - YouTube filler → rendered via the YouTube iframe embed API
//   - Ad breaks      → YouTube iframe swapped in for the ad filler playlist
//   - Filler         → YouTube iframe with filler playlist, muted autoplay
//
// The component receives a PlaybackState from usePlayback and a clockOffsetMs
// value for drift-corrected seeking, then manages its own internal timer to
// trigger transitions at the right server-clock millisecond.
//
// Architecture note: Plex playback is not a direct browser connection to the
// Plex web app. The browser streams through /api/plex-stream, which uses the
// user's Plex credentials server-side to fetch metadata and media bytes.

import { useEffect, useRef, useState, useCallback } from 'react'
import type { PlaybackState } from '@/lib/playback'
import type { PlexTrack, TracksResponse } from '@/app/api/plex-stream/tracks/route'
import Hls from 'hls.js'
import RatingBug from './RatingBug'
import { DEFAULT_VHS_SETTINGS } from '@/lib/vhs-defaults'

interface Props {
  state:          PlaybackState | null
  plexServerUrl:  string | null  // From session — null if not logged in
  plexToken:      string | null
  clockOffsetMs:  number
  isLoading:      boolean
}

type ActiveLayer = 'plex' | 'youtube' | 'offline'

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatTimestamp(ms: number | null): string {
  if (!ms) return '-'
  return new Date(ms).toLocaleString('en-AU', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function getReadableTrackLabel(track: PlexTrack, kind: 'audio' | 'subtitle'): string {
  if (kind === 'subtitle' && track.id === '0') return 'Off (No subtitles)'

  const language = track.language && track.language !== 'Unknown'
    ? track.language
    : (track.languageCode ? track.languageCode.toUpperCase() : '')
  const rawTitle = (track.title ?? '').trim()

  if (!rawTitle) return language || (kind === 'audio' ? 'Default audio' : 'Subtitle')
  if (!language) return rawTitle

  const rawLower = rawTitle.toLowerCase()
  const langLower = language.toLowerCase()
  if (
    rawLower === langLower
    || rawLower.startsWith(`${langLower} (`)
    || rawLower.startsWith(`${langLower} -`)
    || rawLower.startsWith(`${langLower} —`)
  ) {
    return rawTitle
  }

  return `${language} - ${rawTitle}`
}

// Build a YouTube embed URL.
// We prefer a plain video queue when playback selected multiple items for a slot.
function youtubeEmbedUrl(videoIds: string[], offsetSecs = 0, withSound = false): string {
  const [primaryId] = videoIds
  const isPlaylist = videoIds.length === 1 && (
    primaryId.startsWith('PL')
    || primaryId.startsWith('RD')
    || primaryId.startsWith('UU')
  )

  const params = new URLSearchParams({
    autoplay:     '1',
    // Start muted for browser autoplay compliance unless we already have user interaction.
    mute:         withSound ? '0' : '1',
    playsinline:  '1',
    controls:     '0',
    modestbranding: '1',
    rel:          '0',
    iv_load_policy: '3',
    disablekb:    '1',
    fs:           '0',
    cc_load_policy: '0',
    enablejsapi:  '1',
  })

  if (offsetSecs > 0) params.set('start', String(Math.floor(offsetSecs)))

  if (videoIds.length > 1) {
    params.set('playlist', videoIds.join(','))
    return `https://www.youtube.com/embed/${primaryId}?${params}`
  }

  if (isPlaylist) {
    params.set('list',       primaryId)
    params.set('listType',   'playlist')
    params.set('index',      '1')
    return `https://www.youtube.com/embed/videoseries?${params}`
  }

  return `https://www.youtube.com/embed/${primaryId}?${params}`
}

export default function VideoPlayer({
  state,
  plexServerUrl,
  plexToken,
  clockOffsetMs,
  isLoading,
}: Props) {
  const [layer, setLayer]               = useState<ActiveLayer>('offline')
  const [offlineGraphic, setOfflineGraphic] = useState('')
  const [plexHlsUrl, setPlexHlsUrl]     = useState('')
  const [plexOffsetMs, setPlexOffsetMs] = useState(0)
  const [youtubeSrc, setYoutubeSrc]     = useState('')
  const [hasUserInteraction, setHasUserInteraction] = useState(false)
  const [showRating, setShowRating]     = useState(false)
  const [currentRating, setRating]      = useState('PG')
  const [ratingCueKey, setRatingCueKey] = useState(0)
  const [debugAllowed, setDebugAllowed] = useState(DEFAULT_VHS_SETTINGS.debugOverlayEnabled)
  const [debugVisible, setDebugVisible] = useState(false)
  const [debugNowMs, setDebugNowMs]     = useState(Date.now())
  // Track selection
  const [audioTracks, setAudioTracks]       = useState<PlexTrack[]>([])
  const [subtitleTracks, setSubtitleTracks] = useState<PlexTrack[]>([])
  const [selectedAudio, setSelectedAudio]   = useState<string | null>(null)
  const [selectedSub, setSelectedSub]       = useState<string | null>(null)
  const [showAudioMenu, setShowAudioMenu]   = useState(false)
  const [showSubMenu, setShowSubMenu]       = useState(false)
  const subMenuRef                         = useRef<HTMLDivElement | null>(null)
  const audioMenuRef                       = useRef<HTMLDivElement | null>(null)
  const prevTrackContentIdRef               = useRef<string | null>(null)
  const transitionTimerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevContentIdRef                = useRef<string | null>(null)
  const prevSourceRef                   = useRef<string | null>(null)
  const prevStationIdRef                = useRef<string | null>(null)
  const prevSlotStartMsRef              = useRef<number | null>(null)
  const prevYoutubeQueueRef             = useRef<string>('')
  const timelineAuthFailedRef            = useRef(false)
  const videoRef                        = useRef<HTMLVideoElement | null>(null)
  const hlsRef                          = useRef<Hls | null>(null)
  const clientSessionIdRef              = useRef(`zombietv-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`)
  // Refs so applyState never needs to depend on derived state, avoiding reload loops
  const youtubeSrcRef                   = useRef<string>('')
  const hasUserInteractionRef           = useRef(false)

  const buildPlexStreamUrl = useCallback((contentId: string, offsetMs: number, audioId?: string | null, subId?: string | null) => {
    const params = new URLSearchParams({
      contentId,
      offsetSecs: String(Math.floor(Math.max(0, offsetMs) / 1000)),
      format: 'hls',
      clientSessionId: clientSessionIdRef.current,
    })
    if (audioId) params.set('audioStreamId', audioId)
    if (subId && subId !== '0') params.set('subtitleStreamId', subId)
    return `/api/plex-stream?${params.toString()}`
  }, [])

  const sendPlexTimeline = useCallback(async (
    s: PlaybackState,
    timelineState: 'playing' | 'paused' | 'stopped' | 'buffering' = 'playing',
  ) => {
    if (s.contentSource !== 'plex' || !s.contentId) return
    if (timelineAuthFailedRef.current) return

    const video = videoRef.current
    const videoTimeMs = video && Number.isFinite(video.currentTime) ? Math.max(0, Math.floor(video.currentTime * 1000)) : null
    const correctedNow = Date.now() + clockOffsetMs
    const computedOffsetMs = Math.max(0, Math.floor(s.startOffsetMs + (correctedNow - s.serverTimeMs)))
    const offsetMs = videoTimeMs ?? computedOffsetMs

    const videoDurationMs = video && Number.isFinite(video.duration) && video.duration > 0
      ? Math.floor(video.duration * 1000)
      : Math.max(0, s.slotEndMs - s.slotStartMs)

    try {
      await fetch('/api/plex-stream/timeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          contentId: s.contentId,
          offsetMs,
          durationMs: videoDurationMs,
          state: timelineState,
          clientSessionId: clientSessionIdRef.current,
        }),
      }).then((res) => {
        if (res.status === 401) {
          timelineAuthFailedRef.current = true
        }
      })
    } catch {
      // Keep playback resilient even if timeline relay fails.
    }
  }, [clockOffsetMs])

  const loadTracks = useCallback(async (contentId: string) => {
    try {
      const res = await fetch(`/api/plex-stream/tracks?contentId=${encodeURIComponent(contentId)}`, {
        credentials: 'include',
      })
      if (!res.ok) return
      const data: TracksResponse = await res.json()
      setAudioTracks(data.audio ?? [])
      setSubtitleTracks(data.subtitles ?? [])
      const defaultAudio = (data.audio ?? []).find((t) => t.selected)
      const defaultSub   = (data.subtitles ?? []).find((t) => t.selected)
      if (defaultAudio) setSelectedAudio(defaultAudio.id)
      if (defaultSub) setSelectedSub(defaultSub.id)
    } catch {
      // Keep playback resilient if track metadata cannot be loaded.
    }
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
    } finally {
      window.location.assign('/')
    }
  }, [])

  // Derive current layer and URLs from playback state
  const applyState = useCallback((s: PlaybackState) => {
    if (s.contentSource !== 'plex') {
      timelineAuthFailedRef.current = false
    }
    const correctedNow  = Date.now() + clockOffsetMs
    const offsetMs      = Math.max(0, s.startOffsetMs + (correctedNow - s.serverTimeMs))

    const playbackSegmentChanged =
      s.contentId !== prevContentIdRef.current ||
      s.contentSource !== prevSourceRef.current ||
      s.stationId !== prevStationIdRef.current ||
      s.slotStartMs !== prevSlotStartMsRef.current

    const youtubeQueue = s.youtubeQueue?.filter(Boolean) ?? (s.contentId ? [s.contentId] : [])
    const queueSignature = youtubeQueue.join(',')
    const queueChanged = queueSignature !== prevYoutubeQueueRef.current

    prevContentIdRef.current = s.contentId
    prevSourceRef.current    = s.contentSource
    prevStationIdRef.current = s.stationId
    prevSlotStartMsRef.current = s.slotStartMs
    prevYoutubeQueueRef.current = queueSignature

    if (s.contentSource === 'offline') {
      setShowRating(false)
      setYoutubeSrc('')
      youtubeSrcRef.current = ''
      setOfflineGraphic(s.offlineGraphicUrl ?? '')
      setLayer('offline')
      return
    }

    if (s.contentSource === 'plex' && s.contentId) {
      if (playbackSegmentChanged) {
        // Stop any youtube audio immediately when switching to plex
        setYoutubeSrc('')
        youtubeSrcRef.current = ''

        // Clear old URL immediately so player goes to loading state.
        setPlexHlsUrl('')

        // Always use HLS transcode mode so Plex records a proper active client session.
        setPlexOffsetMs(offsetMs)
        setPlexHlsUrl(buildPlexStreamUrl(s.contentId, offsetMs, null, null))

        // Reset track selections for new content
        setSelectedAudio(null)
        setSelectedSub(null)
        setAudioTracks([])
        setSubtitleTracks([])

        setShowRating(true)
        setRating(s.contentRating ?? 'PG')
        setRatingCueKey((prev) => prev + 1)
      }
      setLayer('plex')
      return
    }

    setShowRating(false)

    // YouTube: ads, filler, or youtube-sourced slots
    const ytId = s.contentId
      ?? (s.inAdBreak ? s.adFillerId : s.fillerId)
      ?? null

    const ytQueue = youtubeQueue.length ? youtubeQueue : (ytId ? [ytId] : [])

    if (ytQueue.length) {
      const desiredStartSecs = Math.floor(offsetMs / 1000)
      // Read current mute state from ref — never causes a dep-loop
      const currentMute = (() => {
        if (!youtubeSrcRef.current) return '1'
        try { return new URL(youtubeSrcRef.current).searchParams.get('mute') ?? '1' }
        catch { return '1' }
      })()
      const shouldUpgradeAudio = hasUserInteractionRef.current && currentMute === '1'

      if (playbackSegmentChanged || queueChanged || shouldUpgradeAudio) {
        const newSrc = youtubeEmbedUrl(ytQueue, desiredStartSecs, hasUserInteractionRef.current)
        youtubeSrcRef.current = newSrc
        setYoutubeSrc(newSrc)
      }
      setLayer('youtube')
      return
    }

    setLayer('offline')
  }, [clockOffsetMs, buildPlexStreamUrl])

  // Keep ref in sync with state so applyState can read it without being in deps
  useEffect(() => { hasUserInteractionRef.current = hasUserInteraction }, [hasUserInteraction])
  useEffect(() => { youtubeSrcRef.current = youtubeSrc }, [youtubeSrc])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const debug = new URLSearchParams(window.location.search).get('debug')
    if ((debug === '1' || debug === 'true') && debugAllowed) setDebugVisible(true)
  }, [debugAllowed])

  useEffect(() => {
    const syncDebugFlag = async () => {
      try {
        const res = await fetch('/api/vhs-settings')
        if (!res.ok) return
        const data = await res.json()
        const enabled = Boolean(data?.debugOverlayEnabled)
        setDebugAllowed(enabled)
        if (!enabled) setDebugVisible(false)
      } catch {
        // Keep last known state on network failure.
      }
    }

    syncDebugFlag()
    const timer = setInterval(syncDebugFlag, 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'd' && debugAllowed) {
        setDebugVisible((prev) => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [debugAllowed])

  useEffect(() => {
    const timer = setInterval(() => setDebugNowMs(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  // Browser autoplay policy: once the viewer interacts, upgrade future YouTube playback to sound-on autoplay.
  useEffect(() => {
    if (hasUserInteraction) return

    const markInteracted = () => setHasUserInteraction(true)
    window.addEventListener('pointerdown', markInteracted, { once: true })
    window.addEventListener('keydown', markInteracted, { once: true })

    return () => {
      window.removeEventListener('pointerdown', markInteracted)
      window.removeEventListener('keydown', markInteracted)
    }
  }, [hasUserInteraction])

  // Schedule a refresh at the next transition time
  const scheduleTransition = useCallback((s: PlaybackState) => {
    transitionTimerRef.current && clearTimeout(transitionTimerRef.current)
    const correctedNow = Date.now() + clockOffsetMs
    const msUntil      = Math.max(0, s.nextTransitionMs - correctedNow)

    transitionTimerRef.current = setTimeout(() => {
      // The parent's usePlayback poll will fire shortly; this just nudges early
      applyState(s)
    }, msUntil + 200) // +200ms grace
  }, [clockOffsetMs, applyState])

  useEffect(() => {
    if (!state) return
    applyState(state)
    scheduleTransition(state)
    return () => { transitionTimerRef.current && clearTimeout(transitionTimerRef.current) }
  }, [state, applyState, scheduleTransition])

  useEffect(() => {
    if (layer !== 'plex' || !plexHlsUrl) return

    const video = videoRef.current
    if (!video) return

    const isHlsManifest = plexHlsUrl.includes('format=hls')

    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }

    if (isHlsManifest && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        xhrSetup: (xhr) => {
          xhr.withCredentials = true
        },
      })
      hls.loadSource(plexHlsUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (plexOffsetMs > 0 && Number.isFinite(plexOffsetMs)) {
          const target = plexOffsetMs / 1000
          if (Math.abs(video.currentTime - target) > 1) {
            video.currentTime = target
          }
        }
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad()
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError()
          return
        }
      })
      hlsRef.current = hls
    } else {
      video.src = plexHlsUrl
      video.play().catch(() => {})
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
    }
  }, [layer, plexHlsUrl])

  useEffect(() => {
    if (!state || layer !== 'plex' || state.contentSource !== 'plex' || !state.contentId) return

    sendPlexTimeline(state, 'playing').catch(() => {})
    const timer = setInterval(() => {
      sendPlexTimeline(state, 'playing').catch(() => {})
    }, 10_000)

    return () => {
      clearInterval(timer)
      sendPlexTimeline(state, 'paused').catch(() => {})
    }
  }, [layer, state, sendPlexTimeline])

  // Fetch available audio and subtitle tracks when a new Plex item starts
  useEffect(() => {
    const contentId = state?.contentId
    if (!contentId || state?.contentSource !== 'plex' || layer !== 'plex') return
    if (contentId === prevTrackContentIdRef.current) return
    prevTrackContentIdRef.current = contentId

    loadTracks(contentId)
  }, [state?.contentId, state?.contentSource, layer, loadTracks])

  // When user picks a track, rebuild the HLS URL so Plex transcodes with the new selection
  const handleSelectAudio = useCallback((trackId: string) => {
    setSelectedAudio(trackId)
    setShowAudioMenu(false)
    if (!state?.contentId) return
    const video = videoRef.current
    const currentOffsetMs = video && Number.isFinite(video.currentTime)
      ? Math.floor(video.currentTime * 1000)
      : plexOffsetMs
    setPlexHlsUrl(buildPlexStreamUrl(state.contentId, currentOffsetMs, trackId, selectedSub))
  }, [state?.contentId, plexOffsetMs, selectedSub, buildPlexStreamUrl])

  const handleSelectSub = useCallback((trackId: string) => {
    setSelectedSub(trackId)
    setShowSubMenu(false)
    if (!state?.contentId) return
    const video = videoRef.current
    const currentOffsetMs = video && Number.isFinite(video.currentTime)
      ? Math.floor(video.currentTime * 1000)
      : plexOffsetMs
    setPlexHlsUrl(buildPlexStreamUrl(state.contentId, currentOffsetMs, selectedAudio, trackId))
  }, [state?.contentId, plexOffsetMs, selectedAudio, buildPlexStreamUrl])

  // Allow bottom NowBar buttons to open menus in the player.
  useEffect(() => {
    const openSubtitles = () => {
      if (layer !== 'plex' || !state?.contentId) return
      if (subtitleTracks.length === 0) loadTracks(state.contentId)
      setShowSubMenu(true)
      setShowAudioMenu(false)
    }

    const openAudio = () => {
      if (layer !== 'plex' || !state?.contentId) return
      if (audioTracks.length === 0) loadTracks(state.contentId)
      setShowAudioMenu(true)
      setShowSubMenu(false)
    }

    window.addEventListener('zombietv-open-subtitles', openSubtitles)
    window.addEventListener('zombietv-open-audio', openAudio)

    return () => {
      window.removeEventListener('zombietv-open-subtitles', openSubtitles)
      window.removeEventListener('zombietv-open-audio', openAudio)
    }
  }, [layer, state?.contentId, subtitleTracks.length, audioTracks.length, loadTracks])

  // ── Auto-close menus when clicking outside ──
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node

      // Close subtitle menu if click is outside
      if (showSubMenu && subMenuRef.current && !subMenuRef.current.contains(target)) {
        // Check if click is on the CC button itself (which toggles the menu)
        const ccButton = (event.target as HTMLElement)?.closest('button')
        if (!ccButton?.textContent?.includes('CC')) {
          setShowSubMenu(false)
        }
      }

      // Close audio menu if click is outside
      if (showAudioMenu && audioMenuRef.current && !audioMenuRef.current.contains(target)) {
        // Check if click is on the AUDIO button itself (which toggles the menu)
        const audioButton = (event.target as HTMLElement)?.closest('button')
        if (!audioButton?.textContent?.includes('AUDIO')) {
          setShowAudioMenu(false)
        }
      }
    }

    if (showSubMenu || showAudioMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [showSubMenu, showAudioMenu])

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <>
        <OfflineScreen message="TUNING..." />
        <div style={{
          position:   'fixed',
          top:        'auto',
          left:       'auto',
          bottom:     4,
          right:      92,
          zIndex:     10010,
          display:    'flex',
          gap:        8,
          alignItems: 'center',
          height:     28,
          padding:    '0 4px',
          background: 'rgba(6, 20, 44, 0.88)',
          border:     '1px solid rgba(74,127,181,0.9)',
          borderRadius: 6,
          opacity:    0.65,
        }}>
          <button type="button" onClick={handleLogout} title="Sign out of Plex" style={{ order: 0, flexShrink: 0, background: 'rgba(255,102,0,0.18)', border: '1px solid rgba(255,102,0,0.55)', color: '#fff', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1, opacity: 0.9 }}>LOG OUT</button>
          <button type="button" title="Subtitles (available for Plex playback only)" disabled style={{ order: 1, flexShrink: 0, padding: '4px 10px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', opacity: 0.55, cursor: 'not-allowed', color: '#dbe9ff', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(74,127,181,0.8)', borderRadius: 4 }}>CC</button>
          <button type="button" title="Audio language (available for Plex playback only)" disabled style={{ order: 2, flexShrink: 0, padding: '4px 10px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', opacity: 0.55, cursor: 'not-allowed', color: '#dbe9ff', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(74,127,181,0.8)', borderRadius: 4 }}>AUDIO</button>
        </div>
      </>
    )
  }

  if (layer === 'offline') {
    return (
      <>
        <OfflineScreen message="OFF AIR" graphicUrl={offlineGraphic} />
        <div style={{
          position:   'fixed',
          top:        'auto',
          left:       'auto',
          bottom:     4,
          right:      92,
          zIndex:     260,
          display:    'flex',
          gap:        8,
          alignItems: 'center',
          height:     28,
          padding:    '0 4px',
          background: 'rgba(6, 20, 44, 0.88)',
          border:     '1px solid rgba(74,127,181,0.9)',
          borderRadius: 6,
          opacity:    0.65,
        }}>
          <button type="button" onClick={handleLogout} title="Sign out of Plex" style={{ order: 0, flexShrink: 0, background: 'rgba(255,102,0,0.18)', border: '1px solid rgba(255,102,0,0.55)', color: '#fff', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', lineHeight: 1, opacity: 0.9 }}>LOG OUT</button>
          <button type="button" title="Subtitles (available for Plex playback only)" disabled style={{ order: 1, flexShrink: 0, padding: '4px 10px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', opacity: 0.55, cursor: 'not-allowed', color: '#dbe9ff', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(74,127,181,0.8)', borderRadius: 4 }}>CC</button>
          <button type="button" title="Audio language (available for Plex playback only)" disabled style={{ order: 2, flexShrink: 0, padding: '4px 10px', fontSize: '11px', fontWeight: 700, letterSpacing: '0.03em', opacity: 0.55, cursor: 'not-allowed', color: '#dbe9ff', background: 'rgba(0,0,0,0.45)', border: '1px solid rgba(74,127,181,0.8)', borderRadius: 4 }}>AUDIO</button>
        </div>
      </>
    )
  }

  const correctedNowMs = debugNowMs + clockOffsetMs
  const activeOffsetMs = state
    ? Math.max(0, state.startOffsetMs + (correctedNowMs - state.serverTimeMs))
    : 0
  const transitionInMs = state
    ? Math.max(0, state.nextTransitionMs - correctedNowMs)
    : 0
  const streamMode = layer === 'plex'
    ? (plexHlsUrl.includes('format=hls') ? 'hls-proxy' : 'direct-proxy')
    : (layer === 'youtube' ? 'youtube-embed' : 'offline')
  const trackControlsEnabled = layer === 'plex' && Boolean(state?.contentId)

  return (
    <div 
      style={{ 
        position: 'relative', 
        width: '100%', 
        height: '100%', 
        backgroundColor: '#000',
        // Add VHS/broadcast tape degradation to the entire video container
        filter: 'saturate(0.92) brightness(0.98)',
      }}
      onKeyDown={(e) => {
        // Prevent space bar and other keys from controlling video
        if ([' ', 'k', 'm', 'f', 'j', 'l', 'arrowleft', 'arrowright', 'c'].includes(e.key.toLowerCase())) {
          e.preventDefault()
        }
      }}
      role="none"
    >

      {/* Plex video player — HTML5 video tag with HLS stream */}
      {plexHlsUrl && layer === 'plex' && (
        <video
          key={`plex-${state?.stationId ?? 'unknown'}-${state?.slotStartMs ?? 0}-${state?.contentId ?? 'unknown'}`}
          ref={videoRef}
          autoPlay
          muted={!hasUserInteraction}
          onCanPlay={(e) => {
            // Seek to the correct offset when video is ready
            const video = e.target as HTMLVideoElement
            if (video.duration > 0 && plexOffsetMs > 0) {
              const offsetSecs = plexOffsetMs / 1000
              if (Math.abs(video.currentTime - offsetSecs) > 1) {
                video.currentTime = offsetSecs
              }
            }
            video.play().catch(() => {})
          }}
          onError={() => {
            // Keep player state intact; next poll/transition will refresh stream URL if needed.
          }}
          onPause={(e) => {
            // Prevent pausing - resume playback immediately
            (e.target as HTMLVideoElement).play()
          }}
          onClick={(e) => {
            // Prevent pause on click
            e.preventDefault()
            ;(e.target as HTMLVideoElement).play()
          }}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position:   'absolute',
            inset:      0,
            width:      '100%',
            height:     '100%',
            objectFit:  'contain',
            backgroundColor: '#000',
            cursor:     'default',
            // Low-res VHS broadcast effect
            imageRendering: 'pixelated',
            filter: 'contrast(1.05) saturate(0.85)',
          }}
        />
      )}

      {/* Plex loading state while HLS URL is being fetched */}
      {!plexHlsUrl && layer === 'plex' && (
        <div
          style={{
            position:   'absolute',
            inset:      0,
            width:      '100%',
            height:     '100%',
            display:    'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#000',
            color:      '#fff',
            fontSize:   '18px',
          }}
        >
          LOADING PLEX STREAM...
        </div>
      )}

      {/* YouTube layer (ads, filler, music) — only mounted when active to stop background audio */}
      {layer === 'youtube' && youtubeSrc && (
        <iframe
          key={youtubeSrc}
          src={youtubeSrc}
          allow="autoplay; fullscreen; encrypted-media"
          allowFullScreen
          style={{
            position:   'absolute',
            inset:      0,
            width:      '100%',
            height:     '100%',
            border:     'none',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Click shield: never let user clicks reach YouTube iframe controls/overlay. */}
      {layer === 'youtube' && (
        <div
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (!hasUserInteraction) setHasUserInteraction(true)
          }}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            background: 'transparent',
            cursor: 'default',
          }}
        />
      )}

      {/* Australian rating bug — shown on program start, fades after 5s */}
      <RatingBug
        key={ratingCueKey}
        rating={currentRating}
        visible={showRating}
        position="top-right"
      />

      {/* Ad break banner */}
      {state?.inAdBreak && (
        <div style={{
          position:        'absolute',
          bottom:          0,
          left:            0,
          right:           0,
          backgroundColor: 'rgba(0,0,0,0.75)',
          color:           '#ff6600',
          fontFamily:      'Arial, sans-serif',
          fontSize:        '0.75rem',
          fontWeight:      'bold',
          letterSpacing:   '0.1em',
          padding:         '6px 16px',
          textAlign:       'center',
          zIndex:          10,
        }}>
          ▶ COMMERCIAL BREAK
        </div>
      )}

      {/* Filler banner */}
      {state?.inFiller && !state?.inAdBreak && (
        <div style={{
          position:        'absolute',
          bottom:          0,
          left:            0,
          right:           0,
          backgroundColor: 'rgba(0,0,0,0.6)',
          color:           '#888',
          fontFamily:      'Arial, sans-serif',
          fontSize:        '0.65rem',
          letterSpacing:   '0.1em',
          padding:         '4px 16px',
          textAlign:       'center',
          zIndex:          10,
        }}>
          STATION BREAK
        </div>
      )}

      {/* Audio / Subtitle track selectors — shown for Plex content, options populate from track metadata */}
      <div style={{
        position:   'fixed',
        top:        'auto',
        left:       'auto',
        bottom:     4,
        right:      4,
        zIndex:     10010,
        display:    'flex',
        gap:        8,
        alignItems: 'center',
        height:     28,
        padding:    '0 4px',
        background: 'rgba(6, 20, 44, 0.88)',
        border:     '1px solid rgba(74,127,181,0.9)',
        borderRadius: 6,
        opacity:    trackControlsEnabled ? 1 : 0.65,
      }}>
        <button
          type="button"
          onClick={handleLogout}
          title="Sign out of Plex"
          style={{
            order:        0,
            flexShrink:   0,
            background:   'rgba(255,102,0,0.18)',
            border:       '1px solid rgba(255,102,0,0.55)',
            color:        '#fff',
            borderRadius: 4,
            padding:      '4px 10px',
            cursor:       'pointer',
            fontSize:     '11px',
            fontWeight:   700,
            letterSpacing:'0.03em',
            lineHeight:   1,
            opacity:      0.9,
          }}
        >
          LOG OUT
        </button>

        {/* Subtitle track selector */}
        <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                if (!trackControlsEnabled || !state?.contentId) return
                if (subtitleTracks.length === 0) loadTracks(state.contentId)
                setShowSubMenu((v) => !v)
                setShowAudioMenu(false)
              }}
              title={trackControlsEnabled ? 'Subtitles' : 'Subtitles (available for Plex playback only)'}
              disabled={!trackControlsEnabled}
              style={{
                order:        1,
                flexShrink:   0,
                background:   selectedSub && selectedSub !== '0' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.55)',
                border:       selectedSub && selectedSub !== '0' ? '1px solid rgba(255,255,255,0.6)' : '1px solid rgba(255,255,255,0.25)',
                color:        '#fff',
                borderRadius: 4,
                padding:      '4px 10px',
                cursor:       trackControlsEnabled ? 'pointer' : 'not-allowed',
                fontSize:     '11px',
                fontWeight:   700,
                letterSpacing:'0.03em',
                lineHeight:   1,
                opacity:      trackControlsEnabled ? 0.85 : 0.45,
              }}
            >
              CC
            </button>
            {showSubMenu && trackControlsEnabled && (
              <div
                ref={subMenuRef}
                style={{
                position:   'absolute',
                bottom:     '110%',
                right:      0,
                minWidth:   260,
                background: 'rgba(10,14,24,0.97)',
                border:     '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4,
                overflow:   'hidden',
                boxShadow:  '0 4px 16px rgba(0,0,0,0.6)',
              }}>
                <div style={{ padding: '7px 10px', color: '#4a7fb5', fontSize: '0.64rem', letterSpacing: '0.08em', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  SUBTITLES (CHOOSE ONE)
                </div>
                {(subtitleTracks.length ? subtitleTracks : [{ id: 'none', title: 'No subtitles available for this video', selected: false, index: -1, language: '', languageCode: '' } as PlexTrack]).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => t.id !== 'none' && handleSelectSub(t.id)}
                    style={{
                      display:    'block',
                      width:      '100%',
                      textAlign:  'left',
                      padding:    '7px 12px',
                      background: t.id === selectedSub ? 'rgba(255,255,255,0.12)' : 'transparent',
                      border:     'none',
                      color:      t.id === selectedSub ? '#fff' : '#a8c4e0',
                      fontSize:   '0.72rem',
                      cursor:     t.id === 'none' ? 'default' : 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    {t.id === selectedSub ? '✓ Current: ' : ''}{getReadableTrackLabel(t, 'subtitle')}
                  </button>
                ))}
              </div>
            )}
        </div>

        {/* Audio track selector */}
        <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => {
                if (!trackControlsEnabled || !state?.contentId) return
                if (audioTracks.length === 0) loadTracks(state.contentId)
                setShowAudioMenu((v) => !v)
                setShowSubMenu(false)
              }}
              title={trackControlsEnabled ? 'Audio language' : 'Audio language (available for Plex playback only)'}
              disabled={!trackControlsEnabled}
              style={{
                order:        2,
                flexShrink:   0,
                background:   'rgba(0,0,0,0.55)',
                border:       '1px solid rgba(255,255,255,0.25)',
                color:        '#fff',
                borderRadius: 4,
                padding:      '4px 10px',
                cursor:       trackControlsEnabled ? 'pointer' : 'not-allowed',
                fontSize:     '11px',
                fontWeight:   700,
                letterSpacing:'0.03em',
                lineHeight:   1,
                opacity:      trackControlsEnabled ? 0.85 : 0.45,
              }}
            >
              AUDIO
            </button>
            {showAudioMenu && trackControlsEnabled && (
              <div
                ref={audioMenuRef}
                style={{
                position:   'absolute',
                bottom:     '110%',
                right:      0,
                minWidth:   260,
                background: 'rgba(10,14,24,0.97)',
                border:     '1px solid rgba(255,255,255,0.2)',
                borderRadius: 4,
                overflow:   'hidden',
                boxShadow:  '0 4px 16px rgba(0,0,0,0.6)',
              }}>
                <div style={{ padding: '7px 10px', color: '#4a7fb5', fontSize: '0.64rem', letterSpacing: '0.08em', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  AUDIO LANGUAGE (CHOOSE ONE)
                </div>
                {(audioTracks.length ? audioTracks : [{ id: 'none', title: 'No alternate audio available', selected: false, index: -1, language: '', languageCode: '' } as PlexTrack]).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => t.id !== 'none' && handleSelectAudio(t.id)}
                    style={{
                      display:    'block',
                      width:      '100%',
                      textAlign:  'left',
                      padding:    '7px 12px',
                      background: t.id === selectedAudio ? 'rgba(255,255,255,0.12)' : 'transparent',
                      border:     'none',
                      color:      t.id === selectedAudio ? '#fff' : '#a8c4e0',
                      fontSize:   '0.72rem',
                      cursor:     t.id === 'none' ? 'default' : 'pointer',
                      borderBottom: '1px solid rgba(255,255,255,0.05)',
                    }}
                  >
                    {t.id === selectedAudio ? '✓ Current: ' : ''}{getReadableTrackLabel(t, 'audio')}
                  </button>
                ))}
              </div>
            )}
        </div>
      </div>


      {/* Debug HUD: technical details for current playback state */}
      {debugAllowed && (
        <button
          type="button"
          onClick={() => setDebugVisible((prev) => !prev)}
          style={{
            position: 'absolute',
            top: 10,
            left: 10,
            zIndex: 30,
            border: '1px solid rgba(255,255,255,0.35)',
            background: 'rgba(0,0,0,0.55)',
            color: debugVisible ? '#7fff7f' : '#d0d0d0',
            fontFamily: 'monospace',
            fontSize: '11px',
            letterSpacing: '0.04em',
            padding: '4px 6px',
            cursor: 'pointer',
          }}
          title="Toggle debug overlay (D)"
        >
          DBG
        </button>
      )}

      {debugAllowed && debugVisible && (
        <div
          style={{
            position: 'absolute',
            top: 40,
            left: 10,
            zIndex: 30,
            width: 'min(560px, calc(100% - 20px))',
            maxHeight: 'calc(100% - 54px)',
            overflowY: 'auto',
            background: 'rgba(0, 0, 0, 0.78)',
            border: '1px solid rgba(127,255,127,0.45)',
            color: '#b8ffb8',
            fontFamily: 'Consolas, Menlo, Monaco, monospace',
            fontSize: '11px',
            lineHeight: 1.4,
            padding: '8px 10px',
            whiteSpace: 'pre-wrap',
            pointerEvents: 'none',
          }}
        >
          {[
            `stationId         : ${state?.stationId ?? '-'}`,
            `layer             : ${layer}`,
            `streamMode        : ${streamMode}`,
            `source            : ${state?.contentSource ?? '-'}`,
            `contentId         : ${state?.contentId ?? '-'}`,
            `title             : ${state?.title ?? '-'}`,
            `showTitle         : ${state?.showTitle ?? '-'}`,
            `season/episode    : ${state?.seasonNumber ?? '-'} / ${state?.episodeNumber ?? '-'}`,
            `rating            : ${state?.contentRating ?? '-'}`,
            `inAdBreak         : ${state?.inAdBreak ? 'yes' : 'no'}`,
            `inFiller          : ${state?.inFiller ? 'yes' : 'no'}`,
            `activeOffset      : ${formatDuration(activeOffsetMs)} (${activeOffsetMs}ms)`,
            `nextTransitionIn  : ${formatDuration(transitionInMs)} (${transitionInMs}ms)`,
            `slotStart         : ${formatTimestamp(state?.slotStartMs ?? null)}`,
            `slotEnd           : ${formatTimestamp(state?.slotEndMs ?? null)}`,
            `adBreakEnds       : ${formatTimestamp(state?.adBreakEndsMs ?? null)}`,
            `serverTime        : ${formatTimestamp(state?.serverTimeMs ?? null)}`,
            `correctedClient   : ${formatTimestamp(correctedNowMs)}`,
            `clockOffset       : ${clockOffsetMs.toFixed(0)}ms`,
            `youtubeQueueLen   : ${state?.youtubeQueue?.length ?? 0}`,
            `youtubeQueue      : ${(state?.youtubeQueue?.slice(0, 4).join(', ') || '-')}`,
            `fillerId          : ${state?.fillerId ?? '-'}`,
            `adFillerId        : ${state?.adFillerId ?? '-'}`,
            `plexServerUrl     : ${plexServerUrl ?? '-'}`,
            `plexTokenLoaded   : ${plexToken ? 'yes' : 'no'}`,
            `plexUrl           : ${plexHlsUrl || '-'}`,
            `youtubeSrc        : ${youtubeSrc || '-'}`,
          ].join('\n')}
        </div>
      )}
    </div>
  )
}

// ── Offline / test-card screen ────────────────────────────────────────────────

function OfflineScreen({ message, graphicUrl }: { message: string; graphicUrl?: string }) {
  if (graphicUrl) {
    return (
      <div style={{
        width:           '100%',
        height:          '100%',
        backgroundColor: '#000',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
      }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={graphicUrl} alt="Close down" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      </div>
    )
  }
  return (
    <div style={{
      width:           '100%',
      height:          '100%',
      backgroundColor: '#000',
      display:         'flex',
      flexDirection:   'column',
      alignItems:      'center',
      justifyContent:  'center',
      gap:             '20px',
    }}>
      {/* Test card colour bars */}
      <div style={{ display: 'flex', width: '60%', height: '8px' }}>
        {['#b8b8b8', '#ff0', '#0ff', '#0f0', '#f0f', '#f00', '#00f'].map((c) => (
          <div key={c} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </div>

      <div style={{
        color:       '#d2d2d2',
        fontFamily:  'monospace',
        fontSize:    '1.2rem',
        letterSpacing: '0.3em',
        opacity:     0.6,
      }}>
        {message}
      </div>

      {/* Test card colour bars (bottom) */}
      <div style={{ display: 'flex', width: '60%', height: '8px' }}>
        {['#00f', '#f00', '#f0f', '#0f0', '#0ff', '#ff0', '#b8b8b8'].map((c) => (
          <div key={c} style={{ flex: 1, backgroundColor: c }} />
        ))}
      </div>
    </div>
  )
}
