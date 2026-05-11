import { Pool } from 'pg'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string
  timestamp: string
  prompt: string
  audioUrl: string
  lyrics: string | null
}

export interface MessengerSettings {
  pageAccessToken: string
  verifyToken: string
  appSecret: string
}

// ─── Detect backend ──────────────────────────────────────────────────────────

const usePg = !!process.env.DATABASE_URL

// ─── PostgreSQL backend ──────────────────────────────────────────────────────

let pool: Pool | null = null

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    })
  }
  return pool
}

async function initPg() {
  const p = getPool()
  await p.query(`
    CREATE TABLE IF NOT EXISTS generations (
      id TEXT PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      prompt TEXT NOT NULL,
      audio_base64 TEXT,
      lyrics TEXT
    )
  `)
  await p.query(`
    CREATE TABLE IF NOT EXISTS messenger_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)
}

// ─── Filesystem backend ──────────────────────────────────────────────────────

const GEN_DIR = join(process.cwd(), 'public', 'generations')
const INDEX = join(GEN_DIR, 'index.json')
const SETTINGS_PATH = join(process.cwd(), 'data', 'messenger-settings.json')

function ensureDir() {
  if (!existsSync(GEN_DIR)) mkdirSync(GEN_DIR, { recursive: true })
}

function readIndex(): HistoryEntry[] {
  try { return JSON.parse(readFileSync(INDEX, 'utf-8')) } catch { return [] }
}

function writeIndex(entries: HistoryEntry[]) {
  writeFileSync(INDEX, JSON.stringify(entries, null, 2))
}

function readFsSettings(): MessengerSettings {
  try { return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8')) } catch { return { pageAccessToken: '', verifyToken: '', appSecret: '' } }
}

function writeFsSettings(s: MessengerSettings) {
  if (!existsSync(join(process.cwd(), 'data'))) mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2))
}

// ─── Unified API ─────────────────────────────────────────────────────────────

export async function getHistory(): Promise<HistoryEntry[]> {
  if (usePg) {
    await initPg()
    const { rows } = await getPool().query(
      'SELECT id, timestamp, prompt, lyrics, audio_base64 FROM generations ORDER BY timestamp DESC'
    )
    return rows.map((r: { id: string; timestamp: string; prompt: string; lyrics: string | null; audio_base64: string | null }) => ({
      id: r.id,
      timestamp: r.timestamp,
      prompt: r.prompt,
      audioUrl: r.audio_base64 ? `/api/audio/${r.id}` : '',
      lyrics: r.lyrics ?? null,
    }))
  }

  ensureDir()
  return readIndex()
}

export async function addHistory(prompt: string, audio: string | null, lyrics: string | null): Promise<HistoryEntry> {
  const id = Date.now().toString()

  if (usePg) {
    await initPg()
    const audioBase64 = audio ? audio.replace(/^data:audio\/\w+;base64,/, '') : null
    await getPool().query(
      'INSERT INTO generations (id, prompt, audio_base64, lyrics) VALUES ($1, $2, $3, $4)',
      [id, prompt, audioBase64, lyrics]
    )
    return {
      id,
      timestamp: new Date().toISOString(),
      prompt,
      audioUrl: audioBase64 ? `/api/audio/${id}` : '',
      lyrics: lyrics ?? null,
    }
  }

  ensureDir()
  let audioUrl = ''
  if (audio) {
    const base64 = audio.replace(/^data:audio\/\w+;base64,/, '')
    writeFileSync(join(GEN_DIR, `${id}.mp3`), Buffer.from(base64, 'base64'))
    audioUrl = `/generations/${id}.mp3`
  }
  const entry: HistoryEntry = { id, timestamp: new Date().toISOString(), prompt, audioUrl, lyrics: lyrics ?? null }
  writeIndex([entry, ...readIndex()])
  return entry
}

export async function deleteHistory(id: string): Promise<void> {
  if (usePg) {
    await initPg()
    await getPool().query('DELETE FROM generations WHERE id = $1', [id])
    return
  }

  ensureDir()
  const entries = readIndex()
  const entry = entries.find(e => e.id === id)
  if (entry?.audioUrl) {
    try { unlinkSync(join(process.cwd(), 'public', entry.audioUrl)) } catch { /* gone */ }
  }
  writeIndex(entries.filter(e => e.id !== id))
}

export async function getAudioBase64(id: string): Promise<string | null> {
  if (usePg) {
    await initPg()
    const { rows } = await getPool().query('SELECT audio_base64 FROM generations WHERE id = $1', [id])
    return rows[0]?.audio_base64 ?? null
  }

  const path = join(GEN_DIR, `${id}.mp3`)
  if (!existsSync(path)) return null
  return readFileSync(path).toString('base64')
}

export async function getSettings(): Promise<MessengerSettings> {
  if (usePg) {
    await initPg()
    const { rows } = await getPool().query('SELECT key, value FROM messenger_settings')
    const map = Object.fromEntries(rows.map((r: { key: string; value: string }) => [r.key, r.value]))
    return {
      pageAccessToken: map.pageAccessToken ?? '',
      verifyToken: map.verifyToken ?? '',
      appSecret: map.appSecret ?? '',
    }
  }

  return readFsSettings()
}

export async function saveSettings(s: MessengerSettings): Promise<void> {
  if (usePg) {
    await initPg()
    for (const [key, value] of Object.entries(s)) {
      await getPool().query(
        `INSERT INTO messenger_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      )
    }
    return
  }

  writeFsSettings(s)
}
