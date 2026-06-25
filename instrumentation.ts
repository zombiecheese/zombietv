// Next.js Instrumentation Hook
// Runs ONCE when the server process starts (not per request, not per hot-reload module).
// This is the correct place to start background tasks like the scheduler.
//
// Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// To enable this file, add the following to next.config.js:
//   experimental: { instrumentationHook: true }

export async function register() {
  // Only run in the Node.js runtime (not in Edge runtime or during build)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Apply the configured broadcast timezone to the process BEFORE the
    // scheduler runs, so all schedule generation and playback day math operate
    // in the broadcast zone rather than the container's default (UTC).
    try {
      const { initBroadcastTimezone } = await import('./src/lib/app-settings')
      const tz = await initBroadcastTimezone()
      console.log(`[Instrumentation] Broadcast timezone applied: ${tz}`)
    } catch (err) {
      console.error('[Instrumentation] Failed to apply broadcast timezone:', err)
    }

    // Dynamically import to avoid bundling scheduler code into the Edge runtime
    const { startScheduler } = await import('./src/lib/scheduler')
    startScheduler()
    console.log('[Instrumentation] Background scheduler registered.')
  }
}
