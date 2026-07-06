'use client'

// usePlayback
// Polls /api/now/[stationId] on an interval, clock-drift corrects against
// serverTimeMs, and exposes a ready-to-use PlaybackState to the player.
//
// Clock-drift correction:
//   When the response arrives, we record (serverTimeMs - Date.now()) as
//   clockOffsetMs. All subsequent "what time is it now" calculations add
//   this offset so the client stays in sync with the server even if the
//   user's local clock is wrong.

import { useState, useEffect, useRef, useCallback } from 'react'
import type { PlaybackState } from '@/lib/playback'

const POLL_INTERVAL_MS = 5_000
const HIDDEN_POLL_INTERVAL_MS = 30_000
const NEAR_TRANSITION_POLL_INTERVAL_MS = 1_000
const NEAR_TRANSITION_WINDOW_MS = 15_000

export interface UsePlaybackResult {
  state:           PlaybackState | null
  clockOffsetMs:   number          // server - local; add to Date.now() for server time
  isLoading:       boolean
  error:           string | null
  correctedNowMs:  () => number    // convenience: Date.now() + clockOffsetMs
}

export function usePlayback(stationId: string, enabled = true): UsePlaybackResult {
  const [state, setState]         = useState<PlaybackState | null>(null)
  const [clockOffset, setOffset]  = useState(0)
  const [isLoading, setLoading]   = useState(true)
  const [error, setError]         = useState<string | null>(null)
  const timerRef                  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef                  = useRef<AbortController | null>(null)
  const debugAtRef                = useRef<string | null>(null)
  const latestStateRef            = useRef<PlaybackState | null>(null)
  const clockOffsetRef            = useRef(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const at = new URLSearchParams(window.location.search).get('at')
    debugAtRef.current = at && /^\d+$/.test(at) ? at : null
  }, [])

  const fetchState = useCallback(async () => {
    if (!enabled) return

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const fetchedAt = Date.now()
    try {
      const qs = debugAtRef.current ? `?at=${debugAtRef.current}` : ''
      const res = await fetch(`/api/now/${stationId}${qs}`, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PlaybackState = await res.json()

      // Clock-drift correction: measure round-trip and estimate offset
      const roundTrip      = Date.now() - fetchedAt
      const serverAtFetch  = data.serverTimeMs - roundTrip / 2
      const offset         = serverAtFetch - fetchedAt

      setOffset(offset)
      setState(data)
      setError(null)
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message ?? 'Unknown error')
      }
    } finally {
      setLoading(false)
    }
  }, [stationId, enabled])

  useEffect(() => {
    latestStateRef.current = state
  }, [state])

  useEffect(() => {
    clockOffsetRef.current = clockOffset
  }, [clockOffset])

  const getNextPollDelay = useCallback((): number => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return HIDDEN_POLL_INTERVAL_MS
    }

    const current = latestStateRef.current
    if (!current?.nextTransitionMs) return POLL_INTERVAL_MS

    const correctedNow = Date.now() + clockOffsetRef.current
    const untilTransition = current.nextTransitionMs - correctedNow
    if (untilTransition > 0 && untilTransition <= NEAR_TRANSITION_WINDOW_MS) {
      return NEAR_TRANSITION_POLL_INTERVAL_MS
    }

    return POLL_INTERVAL_MS
  }, [])

  useEffect(() => {
    if (!enabled) {
      timerRef.current && clearTimeout(timerRef.current)
      abortRef.current?.abort()
      setState(null)
      setError(null)
      setLoading(false)
      return
    }

    let active = true
    let eventSource: EventSource | null = null
    let sseFailed = false

    // ── Preferred transport: Server-Sent Events ──────────────────────────
    // The server pushes a state immediately, again right after transitions,
    // and on a heartbeat. Falls back to adaptive polling on any failure.
    const startSse = (): boolean => {
      if (sseFailed || debugAtRef.current || typeof EventSource === 'undefined') return false
      try {
        eventSource = new EventSource(`/api/now/${stationId}/stream`)
      } catch {
        sseFailed = true
        return false
      }

      eventSource.onmessage = (event) => {
        if (!active) return
        try {
          const data: PlaybackState = JSON.parse(event.data)
          // No round-trip measurement on SSE pushes; server time is close
          // enough since pushes are generated at send time.
          setOffset(data.serverTimeMs - Date.now())
          setState(data)
          setError(null)
          setLoading(false)
        } catch {
          // Ignore malformed frames.
        }
      }

      eventSource.onerror = () => {
        // EventSource auto-reconnects; only bail out entirely when the
        // connection never established (e.g. proxy strips streaming).
        if (!active) return
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          eventSource.close()
          eventSource = null
          sseFailed = true
          setLoading(true)
          fetchState().finally(scheduleNext)
        }
      }

      return true
    }

    const stopSse = () => {
      eventSource?.close()
      eventSource = null
    }

    // ── Fallback transport: adaptive polling ─────────────────────────────
    const scheduleNext = () => {
      if (!active || (eventSource && !sseFailed)) return
      const delay = getNextPollDelay()
      timerRef.current = setTimeout(async () => {
        await fetchState()
        scheduleNext()
      }, delay)
    }

    const onVisibilityChange = () => {
      if (!active) return
      if (document.visibilityState === 'hidden') {
        // Streaming to a hidden tab wastes a server loop — drop to nothing;
        // we resync on the next visibility change.
        stopSse()
        return
      }
      if (!sseFailed && !eventSource) {
        setLoading(true)
        if (startSse()) return
      }
      fetchState().catch(() => {})
    }

    setLoading(true)
    if (!startSse()) {
      fetchState().finally(scheduleNext)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      active = false
      stopSse()
      timerRef.current && clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      abortRef.current?.abort()
    }
  }, [fetchState, getNextPollDelay, enabled, stationId])

  return {
    state,
    clockOffsetMs:  clockOffset,
    isLoading,
    error,
    correctedNowMs: () => Date.now() + clockOffset,
  }
}
