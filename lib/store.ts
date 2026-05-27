import { Pool } from 'pg'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { compressAudioBase64 } from './compress'

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

export interface PaymentRecord {
  id: string
  timestamp: string
  amount: number
  senderPhone: string
  transId: string
  message: string
  used: boolean
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
  await p.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      timestamp TIMESTAMPTZ DEFAULT NOW(),
      amount INTEGER NOT NULL,
      sender_phone TEXT NOT NULL,
      trans_id TEXT NOT NULL,
      message TEXT,
      used BOOLEAN DEFAULT FALSE
    )
  `)
  await p.query(`
    CREATE TABLE IF NOT EXISTS messenger_messages (
      id          SERIAL PRIMARY KEY,
      facebook_id TEXT        NOT NULL,
      message_text TEXT,
      quick_reply  TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

// ─── Filesystem backend ──────────────────────────────────────────────────────

const GEN_DIR = join(process.cwd(), 'public', 'generations')
const INDEX = join(GEN_DIR, 'index.json')
const SETTINGS_PATH = join(process.cwd(), 'data', 'messenger-settings.json')
const PAYMENTS_PATH = join(process.cwd(), 'data', 'payments.json')

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

function readFsPayments(): PaymentRecord[] {
  try { return JSON.parse(readFileSync(PAYMENTS_PATH, 'utf-8')) } catch { return [] }
}

function writeFsPayments(list: PaymentRecord[]) {
  if (!existsSync(join(process.cwd(), 'data'))) mkdirSync(join(process.cwd(), 'data'), { recursive: true })
  writeFileSync(PAYMENTS_PATH, JSON.stringify(list, null, 2))
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
      audioUrl: r.audio_base64 ? `/api/audio/${r.id}.mp3` : '',
      lyrics: r.lyrics ?? null,
    }))
  }

  ensureDir()
  return readIndex()
}

export async function addHistory(prompt: string, audio: string | null, lyrics: string | null, senderId?: string): Promise<HistoryEntry> {
  const id = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7)

  if (usePg) {
    await initPg()
    let audioBase64 = audio ? audio.replace(/^data:audio\/\w+;base64,/, '') : null
    if (audioBase64) {
      try {
        audioBase64 = await compressAudioBase64(audioBase64)
      } catch (err) {
        console.warn('[addHistory] compression failed, storing original:', err)
      }
    }
    await getPool().query(
      'INSERT INTO generations (id, prompt, audio_base64, lyrics, sender_id) VALUES ($1, $2, $3, $4, $5)',
      [id, prompt, audioBase64, lyrics, senderId ?? null]
    )
    return {
      id,
      timestamp: new Date().toISOString(),
      prompt,
      audioUrl: audioBase64 ? `/api/audio/${id}.mp3` : '',
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

// ─── Payments ────────────────────────────────────────────────────────────────

function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-]/g, '')
  if (cleaned.startsWith('+261')) return '0' + cleaned.slice(4)
  if (cleaned.startsWith('261')) return '0' + cleaned.slice(3)
  return cleaned
}

export async function addPayment(amount: number, senderPhone: string, transId: string, message: string): Promise<PaymentRecord> {
  const id = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7)
  const record: PaymentRecord = {
    id,
    timestamp: new Date().toISOString(),
    amount,
    senderPhone: normalizePhone(senderPhone),
    transId,
    message,
    used: false,
  }

  if (usePg) {
    await initPg()
    await getPool().query(
      'INSERT INTO payments (id, amount, sender_phone, trans_id, message, used) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, amount, record.senderPhone, transId, message, false]
    )
    return record
  }

  const list = readFsPayments()
  list.unshift(record)
  writeFsPayments(list)
  return record
}

export async function findPendingPayment(
  senderPhone: string,
  expectedAmount: number,
  tolerance: number = 250,
  claimedBy?: string
): Promise<PaymentRecord | null> {
  const normalized = normalizePhone(senderPhone)
  const minAmount = expectedAmount - tolerance
  const maxAmount = expectedAmount + tolerance

  if (usePg) {
    await initPg()
    // Atomic claim: UPDATE WHERE used=FALSE so concurrent requests can't claim the same payment.
    // claimed_by scopes any future release to the original sender only.
    const { rows } = await getPool().query(
      `UPDATE payments SET used = TRUE, claimed_by = $4
       WHERE id = (
         SELECT id FROM payments
         WHERE sender_phone = $1 AND used = FALSE AND amount >= $2 AND amount <= $3
         ORDER BY timestamp DESC
         LIMIT 1
       )
       RETURNING id, timestamp, amount, sender_phone, trans_id, message, used`,
      [normalized, minAmount, maxAmount, claimedBy ?? null]
    )
    if (!rows.length) return null
    const r = rows[0]
    return {
      id: r.id,
      timestamp: r.timestamp,
      amount: r.amount,
      senderPhone: r.sender_phone,
      transId: r.trans_id,
      message: r.message,
      used: r.used,
    }
  }

  const list = readFsPayments()
  const found = list.find(p =>
    normalizePhone(p.senderPhone) === normalized &&
    !p.used &&
    p.amount >= minAmount &&
    p.amount <= maxAmount
  )
  return found ?? null
}

export async function logGenerationError(prompt: string, senderId: string, error: string, paymentId?: string): Promise<void> {
  const id = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 7)
  console.error(`[generation_error] sender:${senderId} payment:${paymentId ?? 'none'} error:${error} prompt:${prompt.slice(0, 120)}`)
  if (usePg) {
    await initPg()
    await getPool().query(
      'INSERT INTO generations (id, prompt, sender_id, error) VALUES ($1, $2, $3, $4)',
      [id, prompt, senderId, error]
    )
  }
}

export async function markPaymentUsed(id: string, generationId?: string): Promise<void> {
  if (usePg) {
    await initPg()
    // Payment already claimed by findPendingPayment — just record the generation_id
    await getPool().query('UPDATE payments SET generation_id = $2 WHERE id = $1', [id, generationId ?? null])
    return
  }

  const list = readFsPayments()
  const updated = list.map(p => p.id === id ? { ...p, used: true } : p)
  writeFsPayments(updated)
}

export async function releasePayment(id: string, claimedBy?: string): Promise<void> {
  if (usePg) {
    await initPg()
    // Only release if the original claimer is releasing — prevents cross-user reclaims.
    await getPool().query(
      'UPDATE payments SET used = FALSE, claimed_by = NULL WHERE id = $1 AND (claimed_by = $2 OR claimed_by IS NULL)',
      [id, claimedBy ?? null]
    )
    return
  }

  const list = readFsPayments()
  const updated = list.map(p => p.id === id ? { ...p, used: false } : p)
  writeFsPayments(updated)
}

export async function getPayments(): Promise<PaymentRecord[]> {
  if (usePg) {
    await initPg()
    const { rows } = await getPool().query(
      'SELECT id, timestamp, amount, sender_phone, trans_id, message, used FROM payments ORDER BY timestamp DESC'
    )
    return rows.map((r: { id: string; timestamp: string; amount: number; sender_phone: string; trans_id: string; message: string; used: boolean }) => ({
      id: r.id,
      timestamp: r.timestamp,
      amount: r.amount,
      senderPhone: r.sender_phone,
      transId: r.trans_id,
      message: r.message,
      used: r.used,
    }))
  }

  return readFsPayments()
}

// ─── Messenger message logging ────────────────────────────────────────────────

export async function logMessage(facebookId: string, messageText: string, quickReply: string | null): Promise<void> {
  if (usePg) {
    await initPg()
    await getPool().query(
      'INSERT INTO messenger_messages (facebook_id, message_text, quick_reply) VALUES ($1, $2, $3)',
      [facebookId, messageText || null, quickReply || null]
    )
  }
}
