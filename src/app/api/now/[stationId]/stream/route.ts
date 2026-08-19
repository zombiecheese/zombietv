// GET /api/now/[stationId]/stream — Server-Sent Events playback stream.
// Pushes a fresh PlaybackState immediately, again right after each scheduled
// transition, and on a slow heartbeat in between. Clients fall back to
// polling /api/now/[stationId] when SSE is unavailable.
//
// Public endpoint — no auth required to watch TV.

import { NextRequest } from 'next/server'
import { getPlaybackState } from '@/lib/playback'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 10_000
const MIN_DELAY_MS = 1_000
const MAX_STREAM_LIFETIME_MS = 60 * 60_000 // force clients to reconnect hourly

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ stationId: string }> },
) {
  const { stationId } = await params

  const known = await prisma.station.findUnique({ where: { id: stationId }, select: { id: true } })
  if (!known) {
    return new Response(JSON.stringify({ error: 'Unknown stationId' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const startedAt = Date.now()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const close = () => {
        if (closed) return
        closed = true
        try { controller.close() } catch { /* already closed */ }
      }
      req.signal.addEventListener('abort', close)

      const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

      try {
        while (!closed && !req.signal.aborted) {
          if (Date.now() - startedAt > MAX_STREAM_LIFETIME_MS) break

          const state = await getPlaybackState(stationId)
          if (closed || req.signal.aborted) break

          controller.enqueue(encoder.encode(`data: ${JSON.stringify(state)}\n\n`))

          // Wake just after the next transition, or on the heartbeat —
          // whichever comes first.
          const untilTransition = state.nextTransitionMs - Date.now() + 300
          const delay = Math.max(MIN_DELAY_MS, Math.min(untilTransition, HEARTBEAT_MS))
          await sleep(delay)
        }
      } catch {
        // Drop the stream; the client reconnects or falls back to polling.
      } finally {
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
