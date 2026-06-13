import { NextRequest, NextResponse } from 'next/server'
import { addPayment, loadConvState, findPendingPayment, markPaymentUsed, addHistory, releasePayment, getSettings, logDeliveryError, logGenerationError } from '@/lib/store'
import { generateMusic } from '@/lib/generate'

const MERCHANT_NUMBER = '0341486900'

/**
 * Reject messages that look like outgoing payments/transfers.
 * Accept only incoming money notifications.
 */
function isIncomingTransaction(messageText: string): boolean {
  const lower = messageText.toLowerCase()

  // Outgoing indicators — if any matches, it's NOT an incoming transaction
  const outgoingPatterns = [
    /\benvoy[ée]\b/,
    /\benvoye\b/,
    /\bpay[ée]\b/,
    /\bpaye\b/,
    /\bpaid\b/,
    /\bsent\b/,
    /\bpaiement\s+effectu[ée]\b/,
    /\btransfert\s+effectu[ée]\b/,
    /\bvirement\s+envoy[ée]\b/,
    /\bvous\s+avez\s+envoy/,
  ]
  for (const p of outgoingPatterns) {
    if (p.test(lower)) return false
  }

  // Incoming indicators — at least one must match
  const incomingPatterns = [
    /\bre[çc]u\b/,
    /\breceived\b/,
    /\bde\s+la\s+part\s+de\b/,
    /\btransfert\s+international\b/,
    /\bre[çc]u\s+de\b/,
  ]
  for (const p of incomingPatterns) {
    if (p.test(lower)) return true
  }

  return false
}

function extractSenderPhone(messageText: string, phonenumber: string): string {
  const text = String(messageText)
  const searchSpace = text.replace(/\s/g, '')

  // 1. Find all Malagasy phone numbers: +2613... or 03...
  const mgMatches = searchSpace.match(/(?:\+261|0)(3[2-49]\d{7})/g)
  if (mgMatches) {
    const candidates = mgMatches
      .map(p => p.replace(/^\+261/, '0'))
      .filter(p => p !== MERCHANT_NUMBER)
    if (candidates.length > 0) return candidates[0]
  }

  // 2. Fallback: spaced Malagasy number after sender keywords
  const spacedMatch = text.match(
    /(?:de\s+la\s+part\s+de|from|depuis|expediteur).*?(0\s*3\s*[2-49](?:\s*\d){7})/i
  )
  if (spacedMatch) {
    const cleaned = spacedMatch[1].replace(/\s/g, '')
    if (cleaned !== MERCHANT_NUMBER) return cleaned
  }

  // 3. International numbers after sender keywords (e.g. +33613083079)
  const intlContextMatch = text.match(
    /(?:de\s+la\s+part\s+de|from|depuis|expediteur|transfert\s+international\s+de)\s*(\+\d[\d\s]{6,14})/i
  )
  if (intlContextMatch) {
    const cleaned = intlContextMatch[1].replace(/\s/g, '')
    if (cleaned !== '+' + MERCHANT_NUMBER && cleaned !== MERCHANT_NUMBER) return cleaned
  }

  // 4. Any international number in the message
  const anyIntl = searchSpace.match(/\+\d{8,15}/g)
  if (anyIntl) {
    const candidates = anyIntl.filter(
      p => p !== '+' + MERCHANT_NUMBER && p !== MERCHANT_NUMBER
    )
    if (candidates.length > 0) return candidates[0]
  }

  // Last resort: use phonenumber from JSON (but this is usually the merchant number)
  return phonenumber.replace(/^\+261/, '0')
}

const FB_API = 'https://graph.facebook.com/v19.0/me/messages'

async function fbSend(recipientId: string, message: object, token: string) {
  const res = await fetch(`${FB_API}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message }),
  })
  if (!res.ok) {
    const body = await res.text()
    try {
      const parsed = JSON.parse(body)
      await logDeliveryError({ senderId: recipientId, errorCode: parsed?.error?.code, errorSubcode: parsed?.error?.error_subcode, errorMessage: parsed?.error?.message ?? `HTTP ${res.status}`, fbResponse: body.slice(0, 500) }).catch(() => {})
    } catch { /* ignore */ }
  }
  return res
}

interface ConvState { step: number; config: Record<string, string>; waitingGenerate: boolean; paymentId?: string }

// Called after recording a payment: if a user is already at step 7 waiting for this phone,
// claim the payment and generate immediately without requiring them to re-enter their number.
async function triggerWaitingUser(senderPhone: string, paymentId: string, req: NextRequest) {
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false })

  try {
    // Find a conversation at step 7 whose config.phone matches
    const { rows } = await pool.query<{ sender_id: string; state: ConvState }>(
      `SELECT sender_id, state FROM conversations
       WHERE state->>'step' = '7'
         AND state->'config'->>'phone' = $1
         AND updated_at > NOW() - INTERVAL '24 hours'
       ORDER BY updated_at DESC LIMIT 1`,
      [senderPhone]
    )
    if (!rows.length) return
    const { sender_id: senderId, state } = rows[0]

    // Atomically claim the payment
    const claim = await pool.query(
      `UPDATE payments SET used = TRUE, claimed_by = $2 WHERE id = $1 AND used = FALSE RETURNING id`,
      [paymentId, senderId]
    )
    if (!claim.rowCount) return // already claimed by concurrent request

    const settings = await getSettings()
    const token = settings.pageAccessToken
    if (!token) return

    const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `${req.nextUrl.protocol}//${req.nextUrl.host}`

    // Build prompt (mirrors webhook/route.ts buildPrompt)
    const GENRE_MAP: Record<string, string> = { Salegy: 'Salegy (traditional Malagasy dance music)', Afrobeat: 'Afrobeat', Reggae: 'Reggae', Trap: 'Trap', 'Hira fivavahana': 'Malagasy gospel worship music, spiritual and devotional', Chorale: 'Choral music with choir voices, harmonized vocal arrangements' }
    const TEMPO_MAP: Record<string, string> = { 'Très lent': 'very slow tempo (40–60 BPM)', 'Lent': 'slow tempo (60–80 BPM)', 'Modéré': 'moderate tempo (80–100 BPM)', 'Entraînant': 'upbeat tempo (100–120 BPM)', 'Rapide': 'fast tempo (120–140 BPM)', 'Très rapide': 'very fast tempo (140+ BPM)' }
    const INSTRUMENT_MAP: Record<string, string> = { 'Guitare': 'featuring guitar', 'Piano': 'featuring piano', 'Synthés': 'featuring synthesizers', 'Cordes': 'featuring strings', 'Cuivres': 'featuring brass and horns', 'Batterie': 'drums-forward', 'Basse': 'heavy bass', 'Groupe complet': 'full band arrangement' }
    const DYNAMICS_MAP: Record<string, string> = { 'Monte vers le refrain': 'quiet intro building into an explosive chorus', 'Puissance constante': 'steady powerful energy from start to finish', 'Couplets calmes': 'alternating quiet verses and powerful choruses', 'Descend en douceur': 'loud opening that gradually mellows into a quiet outro', 'Voix tardive': 'long instrumental buildup with vocals arriving late', 'Calme du début à la fin': 'calm and consistent with subtle variations' }
    const VOCALS_MAP: Record<string, string> = { 'Voix masculine': 'male vocalist', 'Voix féminine': 'female vocalist', 'Voix mixtes': 'male and female vocalists in harmony', 'Instrumental': 'purely instrumental, no vocals' }
    const c = state.config
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
      const lines = c.lyrics.trim().split('\n').filter(Boolean).join(' / ')
      prompt += `\n\nLyrics: ${lines}`
    }

    await fbSend(senderId, { text: '✅ Voamarina ny fandoavanao ! Manomboka ny famoronana hira... ⏳' }, token)

    try {
      const data = await generateMusic(prompt)
      if (!data.audio) throw new Error('no audio')
      const entry = await addHistory(prompt, data.audio, data.lyrics ?? null, senderId)
      await markPaymentUsed(paymentId, entry.id)
      const audioUrl = `${baseUrl}${entry.audioUrl}`
      await fbSend(senderId, { text: '🎵 Indro ny hiranao — efa vita!' }, token)
      await fbSend(senderId, { attachment: { type: 'file', payload: { url: audioUrl, is_reusable: true } } }, token)
      await fbSend(senderId, { attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } } }, token)
      await fbSend(senderId, { text: "✅ Vita ! Alefaso 'Recommencer' raha hamorona hira vaovao." }, token)
      await pool.query(`UPDATE conversations SET state = jsonb_set(jsonb_set(state, '{step}', '0'), '{waitingGenerate}', 'false'), updated_at = NOW() WHERE sender_id = $1`, [senderId])
      console.log(`[payment/webhook] auto-triggered generation ${entry.id} for ${senderId}`)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await logGenerationError(prompt, senderId, errMsg, paymentId)
      await releasePayment(paymentId, senderId)
      await fbSend(senderId, { text: `❌ Erreur génération : ${errMsg}` }, token)
    }
  } finally {
    await pool.end().catch(() => {})
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, phonenumber, id } = body

    if (!message || !phonenumber) {
      return NextResponse.json({ error: 'Missing message or phonenumber' }, { status: 400 })
    }

    // Only process incoming transactions
    if (!isIncomingTransaction(message)) {
      console.log('[payment/webhook] ignored outgoing/non-transaction message:', message)
      return NextResponse.json({ ok: true, ignored: true, reason: 'not incoming transaction' })
    }

    // Extract amount — matches "35500 Ar", "2 500 Ar", "2500Ar"
    const amountMatch = String(message).match(/(\d[\d\s]*)\s*Ar/i)
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/\s/g, ''), 10) : 0

    // Extract Ref / Trans Id — matches "Ref : 123564564" or "Trans Id: MP251020.1417.B29719"
    const transMatch = String(message).match(/(?:Ref|Trans\s*Id)\s*:\s*([A-Za-z0-9.\-_]+)/i)
    const transId = transMatch ? transMatch[1] : 'unknown'

    // Extract customer phone from message text, NOT from phonenumber field.
    // Always use `message` (contains "de la part de NAME PHONE") — `id` is often the
    // MVola service alias ('MVola') which contains no phone number.
    const senderPhone = extractSenderPhone(message, phonenumber)

    const record = await addPayment(amount, senderPhone, transId, message)
    console.log('[payment/webhook] recorded:', record)

    // If a user is already waiting at step 7 with this phone, trigger generation immediately
    // without making them re-enter their number.
    if (amount >= 2250 && amount <= 2750 && senderPhone.match(/^03[2-9]\d{7}$/)) {
      triggerWaitingUser(senderPhone, record.id, req).catch(err =>
        console.error('[payment/webhook] triggerWaitingUser failed:', err)
      )
    }

    return NextResponse.json({ ok: true, record })
  } catch (err) {
    console.error('[payment/webhook]', err)
    const msg = err instanceof Error ? err.message : 'Invalid payload'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
