// Boot-time smoke test for the audio pipeline.
// We load `pg` via eval-require so it stays out of the webpack edge bundle
// (which lacks fs/path/stream that pg + pgpass require).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PgPool = any

export async function runBootSmokeTest(): Promise<void> {
  console.log('[boot-smoke] starting')

  if (!process.env.DATABASE_URL) {
    console.warn('[boot-smoke] no DATABASE_URL — skipping')
    return
  }

  let pool: PgPool
  try {
    const nodeRequire = eval('require') as NodeRequire
    const { Pool } = nodeRequire('pg')
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    })
  } catch (err) {
    console.error('[boot-smoke] cannot load pg:', err instanceof Error ? err.message : err)
    return
  }

  try {
    await pool.query('SELECT 1')

    const { rows: constraints } = await pool.query(
      "SELECT conname FROM pg_constraint WHERE conrelid='generations'::regclass AND conname='audio_base64_no_data_url'"
    )
    if (constraints.length === 0) {
      console.error('[boot-smoke] MISSING constraint audio_base64_no_data_url')
    } else {
      console.log('[boot-smoke] constraint OK')
    }

    const { rows: bad } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM generations WHERE audio_base64 LIKE 'data:%'"
    )
    if (bad[0]?.n > 0) {
      console.error(`[boot-smoke] FOUND ${bad[0].n} corrupted rows with data: prefix`)
    }

    const { rows: sample } = await pool.query(
      "SELECT id, SUBSTRING(audio_base64, 1, 16) AS head FROM generations WHERE audio_base64 IS NOT NULL AND audio_base64 != '' ORDER BY timestamp DESC LIMIT 1"
    )
    if (sample[0]) {
      const decoded = Buffer.from(sample[0].head, 'base64')
      const isID3 = decoded.slice(0, 3).toString('ascii') === 'ID3'
      if (!isID3) {
        console.error(`[boot-smoke] latest gen ${sample[0].id} does not decode to MP3 (first bytes: ${decoded.slice(0, 8).toString('hex')})`)
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
