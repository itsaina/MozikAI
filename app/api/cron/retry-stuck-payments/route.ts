import { NextRequest, NextResponse } from 'next/server'
import { getSettings, addHistory, markPaymentUsed, releasePayment, logGenerationError, logDeliveryError } from '@/lib/store'
import { generateMusic } from '@/lib/generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Max generations per cron run — each takes ~80s and Lyria costs money.
const MAX_PER_RUN = 3
// Skip payments newer than this; gives the normal flow time to consume them.
const MIN_AGE_MINUTES = 60
// Don't try to recover payments older than this (probably refunded or abandoned).
const MAX_AGE_DAYS = 7

interface MusicConfig {
  genre?: string; era?: string; tempo?: string; instrument?: string
  dynamics?: string; vocals?: string; lyrics?: string; phone?: string
}

const TEMPO_MAP: Record<string, string> = {
  'Très lent': 'very slow tempo (40–60 BPM)', 'Lent': 'slow tempo (60–80 BPM)',
  'Modéré': 'moderate tempo (80–100 BPM)', 'Entraînant': 'upbeat tempo (100–120 BPM)',
  'Rapide': 'fast tempo (120–140 BPM)', 'Très rapide': 'very fast tempo (140+ BPM)',
}
const INSTRUMENT_MAP: Record<string, string> = {
  'Guitare': 'featuring guitar', 'Piano': 'featuring piano', 'Synthés': 'featuring synthesizers',
  'Cordes': 'featuring strings', 'Cuivres': 'featuring brass and horns', 'Batterie': 'drums-forward',
  'Basse': 'heavy bass', 'Groupe complet': 'full band arrangement',
}
const DYNAMICS_MAP: Record<string, string> = {
  'Monte vers le refrain': 'quiet intro building into an explosive chorus',
  'Puissance constante': 'steady powerful energy from start to finish',
  'Couplets calmes': 'alternating quiet verses and powerful choruses',
  'Descend en douceur': 'loud opening that gradually mellows into a quiet outro',
  'Voix tardive': 'long instrumental buildup with vocals arriving late',
  'Calme du début à la fin': 'calm and consistent with subtle variations',
}
const VOCALS_MAP: Record<string, string> = {
  'Voix masculine': 'male vocalist', 'Voix féminine': 'female vocalist',
  'Voix mixtes': 'male and female vocalists in harmony',
  'Instrumental': 'purely instrumental, no vocals',
}
const GENRE_MAP: Record<string, string> = {
  'Électro': 'Electronic', 'Classique': 'Classical',
  'Salegy': 'Salegy (traditional Malagasy dance music)',
  'Afrobeat': 'Afrobeat', 'Reggae': 'Reggae', 'Trap': 'Trap',
  'Hira fivavahana': 'Malagasy gospel worship music, spiritual and devotional',
  'Chorale': 'Choral music with choir voices, harmonized vocal arrangements',
}

function stripEmojis(text: string): string {
  return text.replace(/\p{Emoji}/gu, '').replace(/\s+/g, ' ').trim()
}

function buildPrompt(c: MusicConfig): string {
  const parts: string[] = []
  const genreEn = c.genre ? (GENRE_MAP[c.genre] ?? c.genre) : ''
  if (genreEn) parts.push(`${c.era && c.era !== 'Contemporain' && c.era !== 'Avant 1950' ? c.era + ' ' : ''}${genreEn}`)
  else if (c.era) parts.push(c.era === 'Contemporain' ? 'contemporary' : c.era === 'Avant 1950' ? 'pre-1950s' : c.era)
  if (c.tempo && TEMPO_MAP[c.tempo]) parts.push(TEMPO_MAP[c.tempo])
  if (c.instrument) parts.push(INSTRUMENT_MAP[c.instrument] ?? `featuring ${c.instrument}`)
  if (c.dynamics) parts.push(DYNAMICS_MAP[c.dynamics] ?? c.dynamics)
  if (c.vocals) parts.push(VOCALS_MAP[c.vocals] ?? c.vocals)
  let prompt = parts.join(', ')
  if (c.lyrics?.trim()) {
    const cleanLyrics = stripEmojis(c.lyrics)
    const lines = cleanLyrics.split('\n').filter(Boolean).join(' / ')
    prompt += `\n\nLyrics: ${lines}`
  }
  return prompt
}

function configIsUsable(c: MusicConfig | undefined): boolean {
  if (!c) return false
  // Need at least a genre OR custom lyrics to make something meaningful.
  return Boolean((c.genre && c.genre.trim()) || (c.lyrics && c.lyrics.trim()))
}

const FB_API = 'https://graph.facebook.com/v19.0/me/messages'

async function fbSend(senderId: string, message: object, token: string, ctx: { generationId?: string; attachmentType?: string }) {
  // POST_PURCHASE_UPDATE tag is deprecated (error_subcode 1893061) — use RESPONSE instead.
  // Stuck payments are retried after 60 min min so most users will still be within the 24h window.
  const res = await fetch(`${FB_API}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: senderId },
      messaging_type: 'RESPONSE',
      message,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    let errCode: number | undefined, errSub: number | undefined, errMsg: string | undefined
    try {
      const parsed = JSON.parse(body)
      errCode = parsed?.error?.code
      errSub = parsed?.error?.error_subcode
      errMsg = parsed?.error?.message
    } catch { /* ignore */ }
    await logDeliveryError({
      senderId, generationId: ctx.generationId, attachmentType: ctx.attachmentType,
      errorCode: errCode, errorSubcode: errSub,
      errorMessage: errMsg ?? `HTTP ${res.status}`,
      fbResponse: body.slice(0, 500),
    }).catch(() => { /* ignore */ })
  }
  return res
}

interface MatchedUser { senderId: string; config: MusicConfig; source: 'conv_phone' | 'msg_phone' }

async function findMatch(pool: import('pg').Pool, phone: string): Promise<MatchedUser | null> {
  // Strategy 1: most recent conversation whose persisted state.config.phone matches.
  const r1 = await pool.query<{ sender_id: string; state: { config?: MusicConfig } }>(
    `SELECT sender_id, state FROM conversations
     WHERE state->'config'->>'phone' = $1
       AND updated_at > NOW() - INTERVAL '7 days'
     ORDER BY updated_at DESC LIMIT 1`,
    [phone]
  )
  if (r1.rows[0] && configIsUsable(r1.rows[0].state?.config)) {
    return { senderId: r1.rows[0].sender_id, config: r1.rows[0].state!.config!, source: 'conv_phone' }
  }

  // Strategy 2: user typed the phone in chat → find their FB ID → load their conv state.
  // Only consider messages where the text equals exactly the phone (avoids matching
  // mentions of someone elses number).
  const r2 = await pool.query<{ facebook_id: string; state: { config?: MusicConfig } | null }>(
    `SELECT mm.facebook_id, c.state
     FROM messenger_messages mm
     LEFT JOIN conversations c ON c.sender_id = mm.facebook_id
     WHERE mm.message_text = $1
       AND mm.created_at > NOW() - INTERVAL '7 days'
     ORDER BY mm.created_at DESC LIMIT 1`,
    [phone]
  )
  const cfg = r2.rows[0]?.state?.config
  if (r2.rows[0] && configIsUsable(cfg)) {
    return { senderId: r2.rows[0].facebook_id, config: cfg!, source: 'msg_phone' }
  }
  return null
}

interface RunReport {
  runAt: string
  stuckCount: number
  recoveredCount: number
  stuck: Array<{ paymentId: string; phone: string; amount: number; ageMinutes: number }>
  recovered: Array<{ paymentId: string; phone: string; senderId: string; generationId: string; matchSource: string }>
  errors: Array<{ paymentId: string; phone: string; error: string }>
  unmatched: Array<{ paymentId: string; phone: string; reason: string }>
}

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured on server' }, { status: 500 })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `${req.nextUrl.protocol}//${req.nextUrl.host}`

  const { default: PgModule } = await import('pg')
  const pool = new PgModule.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  })

  const settings = await getSettings()
  const fbToken = settings.pageAccessToken
  if (!fbToken) {
    await pool.end().catch(() => {})
    return NextResponse.json({ error: 'pageAccessToken not configured' }, { status: 500 })
  }

  const report: RunReport = {
    runAt: new Date().toISOString(),
    stuckCount: 0,
    recoveredCount: 0,
    stuck: [],
    recovered: [],
    errors: [],
    unmatched: [],
  }

  try {
    const { rows: stuckPayments } = await pool.query<{ id: string; sender_phone: string; amount: number; timestamp: string }>(
      `SELECT id, sender_phone, amount, timestamp
       FROM payments
       WHERE used = FALSE
         AND timestamp < NOW() - INTERVAL '${MIN_AGE_MINUTES} minutes'
         AND timestamp > NOW() - INTERVAL '${MAX_AGE_DAYS} days'
         AND sender_phone ~ '^03[2-9][0-9]{7}$'
         AND sender_phone != '0341486900'
       ORDER BY timestamp ASC`
    )

    report.stuckCount = stuckPayments.length
    for (const p of stuckPayments) {
      const ageMinutes = Math.round((Date.now() - new Date(p.timestamp).getTime()) / 60000)
      report.stuck.push({ paymentId: p.id, phone: p.sender_phone, amount: p.amount, ageMinutes })
    }

    let processed = 0
    for (const p of stuckPayments) {
      if (processed >= MAX_PER_RUN) break

      const match = await findMatch(pool, p.sender_phone)
      if (!match) {
        report.unmatched.push({ paymentId: p.id, phone: p.sender_phone, reason: 'no_user_typed_this_phone' })
        continue
      }

      // Atomic claim — race-safe vs the webhook handler.
      const claim = await pool.query(
        `UPDATE payments SET used = TRUE, claimed_by = $2 WHERE id = $1 AND used = FALSE`,
        [p.id, match.senderId]
      )
      if (claim.rowCount === 0) {
        report.unmatched.push({ paymentId: p.id, phone: p.sender_phone, reason: 'race_lost_already_claimed' })
        continue
      }

      processed += 1
      const prompt = buildPrompt(match.config)

      try {
        const data = await generateMusic(prompt)
        if (!data.audio) throw new Error('model returned no audio')
        const entry = await addHistory(prompt, data.audio, data.lyrics ?? null, match.senderId)
        await markPaymentUsed(p.id, entry.id)

        const audioUrl = `${baseUrl}${entry.audioUrl}`

        // Notice + file + audio (same pattern as webhook delivery)
        await fbSend(match.senderId, {
          text: '🎵 Indro ny hira nasaina nataonao (cron retry) — efa voaomana ho anao izao!',
        }, fbToken, { attachmentType: 'text' })
        await fbSend(match.senderId, {
          attachment: { type: 'file', payload: { url: audioUrl, is_reusable: true } },
        }, fbToken, { generationId: entry.id, attachmentType: 'file' })
        await fbSend(match.senderId, {
          attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } },
        }, fbToken, { generationId: entry.id, attachmentType: 'audio' })

        report.recovered.push({
          paymentId: p.id, phone: p.sender_phone,
          senderId: match.senderId, generationId: entry.id,
          matchSource: match.source,
        })
        report.recoveredCount += 1
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        await logGenerationError(prompt, match.senderId, errMsg, p.id)
        await releasePayment(p.id, match.senderId)
        report.errors.push({ paymentId: p.id, phone: p.sender_phone, error: errMsg })
      }
    }

    return NextResponse.json(report)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), partial: report },
      { status: 500 }
    )
  } finally {
    await pool.end().catch(() => { /* ignore */ })
  }
}

// GET = dry run: same query, no claiming, no generation. Lets n8n preview.
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${expected}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { default: PgModule } = await import('pg')
  const pool = new PgModule.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  })

  try {
    const { rows } = await pool.query<{ id: string; sender_phone: string; amount: number; timestamp: string }>(
      `SELECT id, sender_phone, amount, timestamp
       FROM payments
       WHERE used = FALSE
         AND timestamp < NOW() - INTERVAL '${MIN_AGE_MINUTES} minutes'
         AND timestamp > NOW() - INTERVAL '${MAX_AGE_DAYS} days'
         AND sender_phone ~ '^03[2-9][0-9]{7}$'
         AND sender_phone != '0341486900'
       ORDER BY timestamp ASC`
    )

    const out = []
    for (const p of rows) {
      const ageMinutes = Math.round((Date.now() - new Date(p.timestamp).getTime()) / 60000)
      const match = await findMatch(pool, p.sender_phone)
      out.push({
        paymentId: p.id,
        phone: p.sender_phone,
        amount: p.amount,
        ageMinutes,
        matched: Boolean(match),
        matchSource: match?.source ?? null,
        senderId: match?.senderId ?? null,
      })
    }
    return NextResponse.json({ runAt: new Date().toISOString(), candidates: out })
  } finally {
    await pool.end().catch(() => { /* ignore */ })
  }
}
