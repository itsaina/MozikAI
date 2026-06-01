export async function register() {
  // Only run on Node.js runtime, not edge
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Run smoke test asynchronously so we don't block startup
  runBootSmokeTest().catch(err => console.error('[boot-smoke]', err))
}

async function runBootSmokeTest(): Promise<void> {
  console.log('[boot-smoke] starting')

  if (!process.env.DATABASE_URL) {
    console.warn('[boot-smoke] no DATABASE_URL — skipping')
    return
  }

  const { Pool } = await import('pg')
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  })

  try {
    // 1. DB reachable
    await pool.query('SELECT 1')

    // 2. CHECK constraint exists
    const { rows: constraints } = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid='generations'::regclass AND conname='audio_base64_no_data_url'"
    )
    if (constraints.length === 0) {
      console.error('[boot-smoke] MISSING constraint audio_base64_no_data_url — run migration')
    } else {
      console.log('[boot-smoke] constraint OK')
    }

    // 3. Detect any leftover corrupted rows (should be 0 thanks to constraint)
    const { rows: bad } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM generations WHERE audio_base64 LIKE 'data:%'"
    )
    if (bad[0]?.n > 0) {
      console.error(`[boot-smoke] FOUND ${bad[0].n} corrupted rows with data: prefix — run normalization`)
    }

    // 4. Sample most recent good generation, verify it decodes to ID3 (MP3 magic)
    const { rows: sample } = await pool.query(
      "SELECT id, SUBSTRING(audio_base64, 1, 16) AS head FROM generations WHERE audio_base64 IS NOT NULL AND audio_base64 != '' ORDER BY timestamp DESC LIMIT 1"
    )
    if (sample[0]) {
      const decoded = Buffer.from(sample[0].head, 'base64')
      const isID3 = decoded.slice(0, 3).toString('ascii') === 'ID3'
      if (!isID3) {
        console.error(`[boot-smoke] LATEST gen ${sample[0].id} does not decode to MP3 (first bytes: ${decoded.slice(0, 8).toString('hex')})`)
      } else {
        console.log(`[boot-smoke] latest gen ${sample[0].id} decodes to MP3 OK`)
      }
    }

    console.log('[boot-smoke] done')
  } catch (err) {
    console.error('[boot-smoke] failed:', err instanceof Error ? err.message : err)
  } finally {
    await pool.end().catch(() => { /* ignore */ })
  }
}
