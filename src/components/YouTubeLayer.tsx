'use client'

// YouTubeLayer
// Renders YouTube filler/ad content while hiding as much of YouTube's native
// chrome as possible and giving a clean autoplay experience:
//
//  - The iframe is oversized ~36% vertically and centred, so YouTube's title
//    bar / watch-later chrome (drawn at the frame edges, inside the letterbox
//    bars) is cropped out of view. The 16:9 video itself is width-fitted and
//    survives the crop untouched. The crop is skipped on narrow viewports
//    where the video would pillarbox instead.
//  - Playback starts muted (autoplay-policy safe) and is unmuted in place via
//    the IFrame API postMessage channel once the viewer has interacted —
//    no iframe reload, so the stream never restarts or flashes.
//  - playVideo is re-asserted a few times after load to smooth over slow
//    player boot and paused-on-load edge cases.

import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  src: string        // YouTube embed URL (built by VideoPlayer)
  soundOn: boolean   // true once the viewer has interacted (autoplay policy satisfied)
  volume?: number    // 0–100 TV volume applied via the IFrame API
}

// Wide enough that the video letterboxes vertically inside the oversized
// iframe, i.e. the crop only removes black bars + chrome, never video.
const CROP_MIN_ASPECT = 1.55
const CROP_OVERSCAN = 0.36 // 36% extra height, half cropped from each edge

export default function YouTubeLayer({ src, soundOn, volume = 100 }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const soundOnRef = useRef(soundOn)
  const volumeRef = useRef(volume)
  const [cropped, setCropped] = useState(true)

  const finalSrc = (() => {
    try {
      const u = new URL(src, 'https://www.youtube.com')
      u.searchParams.set('mute', '1') // always start muted; audio is upgraded via the API
      u.searchParams.set('enablejsapi', '1')
      if (typeof window !== 'undefined') u.searchParams.set('origin', window.location.origin)
      return u.toString()
    } catch {
      return src
    }
  })()

  const post = useCallback((func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      'https://www.youtube.com',
    )
  }, [])

  const applySound = useCallback((on: boolean) => {
    if (on) {
      post('unMute')
      post('setVolume', [Math.max(0, Math.min(100, volumeRef.current))])
    } else {
      post('mute')
    }
  }, [post])

  const unlockFromGesture = useCallback(() => {
    // Some browsers require iframe audio changes to be issued from a live
    // user activation callback, not only from a later React effect.
    post('playVideo')
    post('unMute')
    post('setVolume', [Math.max(0, Math.min(100, volumeRef.current))])
  }, [post])

  // Handshake + nudges: the player can take a moment to accept commands, so
  // re-assert play/sound a few times after each load.
  useEffect(() => {
    const nudge = () => {
      iframeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 'zombietv' }),
        'https://www.youtube.com',
      )
      post('playVideo')
      applySound(soundOnRef.current)
    }
    const timers = [300, 1200, 2500, 5000].map((ms) => setTimeout(nudge, ms))
    return () => timers.forEach(clearTimeout)
  }, [finalSrc, post, applySound])

  // In-place audio upgrade — never reload the iframe to change mute state.
  useEffect(() => {
    soundOnRef.current = soundOn
    applySound(soundOn)
  }, [soundOn, applySound])

  useEffect(() => {
    const onGesture = () => {
      soundOnRef.current = true
      unlockFromGesture()
    }

    window.addEventListener('pointerdown', onGesture, true)
    window.addEventListener('keydown', onGesture, true)
    window.addEventListener('touchstart', onGesture, true)

    return () => {
      window.removeEventListener('pointerdown', onGesture, true)
      window.removeEventListener('keydown', onGesture, true)
      window.removeEventListener('touchstart', onGesture, true)
    }
  }, [unlockFromGesture])

  // Live TV volume changes.
  useEffect(() => {
    volumeRef.current = volume
    if (soundOnRef.current) post('setVolume', [Math.max(0, Math.min(100, volume))])
  }, [volume, post])

  // Only crop when the container is wide enough that the crop removes
  // letterbox bars rather than actual video (portrait/mobile keeps full frame).
  useEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const check = () => {
      const rect = el.getBoundingClientRect()
      setCropped(rect.width / Math.max(1, rect.height) >= CROP_MIN_ASPECT)
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const overscanPct = CROP_OVERSCAN * 100

  return (
    <div ref={wrapperRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden', backgroundColor: '#000' }}>
      <iframe
        key={finalSrc}
        ref={iframeRef}
        src={finalSrc}
        title="broadcast-filler"
        allow="autoplay; fullscreen; encrypted-media"
        allowFullScreen
        style={{
          position: 'absolute',
          left: 0,
          width: '100%',
          border: 'none',
          pointerEvents: 'none',
          ...(cropped
            ? { top: `-${overscanPct / 2}%`, height: `${100 + overscanPct}%` }
            : { top: 0, height: '100%' }),
        }}
      />
    </div>
  )
}
