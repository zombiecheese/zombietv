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
    // Dynamically import to avoid bundling scheduler code into the Edge runtime
    const { startScheduler } = await import('./src/lib/scheduler')
    startScheduler()
    console.log('[Instrumentation] Background scheduler registered.')
  }
}
