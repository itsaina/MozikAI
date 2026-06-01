// Boot smoke test — runs once at server startup.
// boot-smoke.ts intentionally avoids importing pg at module top so webpack
// can include it in the bundle without pulling pg into the edge runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { runBootSmokeTest } = await import('./lib/boot-smoke')
    runBootSmokeTest().catch((err: unknown) => console.error('[boot-smoke]', err))
  } catch (err) {
    console.warn('[boot-smoke] skipped:', err instanceof Error ? err.message : err)
  }
}
