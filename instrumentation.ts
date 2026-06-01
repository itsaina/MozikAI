// Defeat webpack static analysis: the dynamic path stops webpack from following
// boot-smoke.ts → pg → pgpass into the edge bundle (which lacks fs/path/stream).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const path = ['.', 'lib', 'boot-smoke'].join('/')
  try {
    const mod = await import(/* webpackIgnore: true */ path)
    mod.runBootSmokeTest().catch((err: unknown) => console.error('[boot-smoke]', err))
  } catch (err) {
    console.error('[boot-smoke] register failed:', err)
  }
}
