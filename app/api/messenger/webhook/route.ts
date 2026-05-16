import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSettings, saveSettings, addHistory, getAudioBase64, findPendingPayment, markPaymentUsed, logMessage } from '@/lib/store'
import { generateMusic } from '@/lib/generate'

// ─── Music config & prompt builder ───────────────────────────────────────────

interface MusicConfig {
  genre: string
  era: string
  tempo: string
  instrument: string
  dynamics: string
  vocals: string
  lyrics: string
  phone?: string
  payment?: string
}

const DEFAULT_CONFIG: MusicConfig = {
  genre: '', era: '', tempo: '', instrument: '', dynamics: '', vocals: '', lyrics: '', phone: '', payment: '',
}

const TEMPO_MAP: Record<string, string> = {
  'Très lent': 'very slow tempo (40–60 BPM)',
  'Lent': 'slow tempo (60–80 BPM)',
  'Modéré': 'moderate tempo (80–100 BPM)',
  'Entraînant': 'upbeat tempo (100–120 BPM)',
  'Rapide': 'fast tempo (120–140 BPM)',
  'Très rapide': 'very fast tempo (140+ BPM)',
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
  'Électro': 'Electronic',
  'Classique': 'Classical',
  'Salegy': 'Salegy (traditional Malagasy dance music)',
  'Afrobeat': 'Afrobeat',
  'Reggae': 'Reggae',
  'Trap': 'Trap',
}

function stripEmojis(text: string): string {
  return text.replace(/\p{Emoji}/gu, '').replace(/\s+/g, ' ').trim()
}

function buildPrompt(c: MusicConfig): string {
  const parts: string[] = []
  const genreEn = GENRE_MAP[c.genre] ?? c.genre
  if (c.genre) parts.push(`${c.era && c.era !== 'Contemporain' && c.era !== 'Avant 1950' ? c.era + ' ' : ''}${genreEn}`)
  else if (c.era) parts.push(c.era === 'Contemporain' ? 'contemporary' : c.era === 'Avant 1950' ? 'pre-1950s' : c.era)
  if (c.tempo) parts.push(TEMPO_MAP[c.tempo] ?? c.tempo)
  if (c.instrument) parts.push(INSTRUMENT_MAP[c.instrument] ?? `featuring ${c.instrument}`)
  if (c.dynamics) parts.push(DYNAMICS_MAP[c.dynamics] ?? c.dynamics)
  if (c.vocals) parts.push(VOCALS_MAP[c.vocals] ?? c.vocals)
  let prompt = parts.join(', ')
  if (c.lyrics.trim()) {
    const cleanLyrics = stripEmojis(c.lyrics)
    const lines = cleanLyrics.split('\n').filter(Boolean).join(' / ')
    prompt += `\n\nLyrics: ${lines}`
  }
  return prompt
}

// ─── Conversation steps ───────────────────────────────────────────────────────

interface QR { title: string; payload: string }
interface Step { key: keyof MusicConfig; question: string; quickReplies: QR[]; textInput?: boolean }

const STEPS: Step[] = [
  {
    key: 'genre', question: 'Karazana (gadona) mozika inona no tianao ?',
    quickReplies: [
      { title: 'Salegy', payload: 'Salegy' }, { title: 'Afrobeat', payload: 'Afrobeat' },
      { title: 'Reggae', payload: 'Reggae' }, { title: 'Trap', payload: 'Trap' },
      { title: 'Hip-Hop', payload: 'Hip-Hop' }, { title: 'Pop', payload: 'Pop' },
      { title: 'R&B', payload: 'R&B' }, { title: 'Jazz', payload: 'Jazz' },
      { title: 'Rock', payload: 'Rock' }, { title: 'Électro', payload: 'Électro' },
      { title: 'Funk', payload: 'Funk' }, { title: 'Soul', payload: 'Soul' },
      { title: 'Passer', payload: 'Passer' },
    ],
  },
  {
    key: 'era', question: 'Taona firy no tianao ? (Karazana mozika tamin\'ny taona firy ?)',
    quickReplies: [
      { title: 'Taona 1950', payload: '1950s' }, { title: 'Taona 1960', payload: '1960s' },
      { title: 'Taona 1970', payload: '1970s' }, { title: 'Taona 1980', payload: '1980s' },
      { title: 'Taona 1990', payload: '1990s' }, { title: 'Taona 2000', payload: '2000s' },
      { title: 'Taona 2010', payload: '2010s' }, { title: 'Taona 2020', payload: '2020s' },
      { title: 'Ankehitriny', payload: 'Contemporain' },
      { title: 'Talohan\'ny 1950', payload: 'Avant 1950' },
      { title: 'Passer', payload: 'Passer' },
      { title: '🔄 Recommencer', payload: 'recommencer' },
    ],
  },
  {
    key: 'tempo', question: 'Hafainganina (tempo) inona ?',
    quickReplies: [
      { title: 'Mora dia mora', payload: 'Très lent' }, { title: 'Mora', payload: 'Lent' },
      { title: 'Antonony', payload: 'Modéré' }, { title: 'Mampihetsika', payload: 'Entraînant' },
      { title: 'Haingana', payload: 'Rapide' }, { title: 'Tena haingana', payload: 'Très rapide' },
      { title: 'Passer', payload: 'Passer' },
      { title: '🔄 Recommencer', payload: 'recommencer' },
    ],
  },
  {
    key: 'instrument', question: 'Fitaovana mozika inona no tokony ho heno indrindra ? (Afaka misafidy eto ambany ianao na manoratra ohatra : piano, basse, batterie)',
    quickReplies: [
      { title: 'Guitare', payload: 'Guitare' }, { title: 'Piano', payload: 'Piano' },
      { title: 'Synthés', payload: 'Synthés' }, { title: 'Cordes', payload: 'Cordes' },
      { title: 'Cuivres', payload: 'Cuivres' }, { title: 'Batterie', payload: 'Batterie' },
      { title: 'Basse', payload: 'Basse' }, { title: 'Groupe complet', payload: 'Groupe complet' },
      { title: 'Passer', payload: 'Passer' },
      { title: '🔄 Recommencer', payload: 'recommencer' },
    ],
  },
  {
    key: 'dynamics', question: "Ahoana ny fiovan'ny herin'ny hira ?",
    quickReplies: [
      { title: 'Miakatra @ refrain', payload: 'Monte vers le refrain' },
      { title: 'Hery tsy miova', payload: 'Puissance constante' },
      { title: 'Tononkira milamina', payload: 'Couplets calmes' },
      { title: 'Midina moramora', payload: 'Descend en douceur' },
      { title: 'Feo tara', payload: 'Voix tardive' },
      { title: 'Milamina hatrany', payload: 'Calme du début à la fin' },
      { title: 'Passer', payload: 'Passer' },
      { title: '🔄 Recommencer', payload: 'recommencer' },
    ],
  },
  {
    key: 'vocals', question: 'Karazana feo inona ? (lehilahy mihira, vehivavy mihira, duo lehilahy sy vehivavy)',
    quickReplies: [
      { title: 'Lehilahy mihira', payload: 'Voix masculine' },
      { title: 'Vehivavy mihira', payload: 'Voix féminine' },
      { title: 'Lehilahy sy vehivavy (Duo)', payload: 'Voix mixtes' },
      { title: 'Instrumental', payload: 'Instrumental' },
      { title: 'Passer', payload: 'Passer' },
      { title: '🔄 Recommencer', payload: 'recommencer' },
    ],
  },
  {
    key: 'lyrics',
    question: "Misy tononkira manokana ? Raha misy, soraty eto. Raha tsia, tsindrio ny Passer",
    quickReplies: [{ title: 'Passer', payload: 'Passer' }],
    textInput: true,
  },
  {
    key: 'payment',
    question: 'Laharana firy  (numéro de téléphone) no nampiasainao nandoavana ? Anaovana vérification.',
    quickReplies: [],
    textInput: true,
  },
]

// ─── Promo sample ────────────────────────────────────────────────────────────

const PROMO_AUDIO_ID = '1778917960448'

// ─── Conversation state (in-memory) ─────────────────────────────────────────

interface ConvState {
  step: number
  config: MusicConfig
  waitingGenerate: boolean
  paymentId?: string
}

const conversations = new Map<string, ConvState>()

// ─── Messenger API helpers ────────────────────────────────────────────────────

const FB_API = 'https://graph.facebook.com/v19.0/me/messages'

async function sendMsg(recipientId: string, message: object, token: string) {
  return fetch(`${FB_API}?access_token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message }),
  })
}

async function sendText(recipientId: string, text: string, token: string) {
  return sendMsg(recipientId, { text }, token)
}

async function sendWithQR(recipientId: string, text: string, qrs: QR[], token: string) {
  return sendMsg(recipientId, {
    text,
    quick_replies: qrs.map(q => ({
      content_type: 'text',
      title: q.title.slice(0, 20),
      payload: q.payload,
    })),
  }, token)
}

async function sendAudio(recipientId: string, audioUrl: string, token: string) {
  await sendMsg(recipientId, {
    attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } },
  }, token)
  await sendMsg(recipientId, {
    attachment: { type: 'file', payload: { url: audioUrl, is_reusable: true } },
  }, token)
}

async function sendStep(recipientId: string, stepIdx: number, token: string) {
  const step = STEPS[stepIdx]
  if (step.quickReplies.length === 0) {
    return sendText(recipientId, step.question, token)
  }
  return sendWithQR(recipientId, step.question, step.quickReplies, token)
}

// ─── Lyria lyrics formatter ───────────────────────────────────────────────────

function formatLyricsForMessenger(raw: string): string {
  const LABELS: Record<string, string> = { A: 'Intro', B: 'Couplet', C: 'Refrain', D: 'Pont', E: 'Outro' }
  const lines: string[] = []
  let cur = ''
  for (const line of raw.split('\n')) {
    const sm = line.match(/^\[\[([A-Z])(\d+)\]\]$/)
    if (sm) { cur = `${LABELS[sm[1]] ?? sm[1]}${parseInt(sm[2]) > 0 ? ' ' + sm[2] : ''}`; continue }
    const lm = line.match(/^\[[\d.]*:?\]\s*(.+)$/)
    if (lm) {
      if (cur) { lines.push(`\n— ${cur} —`); cur = '' }
      lines.push(lm[1].trim())
    }
  }
  return lines.join('\n').trim() || raw.trim()
}

// ─── Public base URL helper ──────────────────────────────────────────────────

function getPublicBaseUrl(req: NextRequest): string {
  // Railway / Vercel env vars are the most reliable source
  if (process.env.RAILWAY_PUBLIC_DOMAIN) {
    return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  // Fallback to request headers (for proxies that set them)
  const forwardedProto = req.headers.get('x-forwarded-proto')
  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }
  // Last resort — req.nextUrl (often wrong behind reverse proxies)
  return `${req.nextUrl.protocol}//${req.nextUrl.host}`
}

// ─── Generate music via internal API ─────────────────────────────────────────

async function generateAndSend(senderId: string, state: ConvState, token: string, baseUrl: string) {
  const prompt = buildPrompt(state.config)
  await sendText(senderId, '🎵 Fanamboarana hira… (30 hatramin\'ny 60 segondra)', token)

  let success = false

  try {
    const data = await generateMusic(prompt)

    // Save to store & send audio
    let audioUrl = ''
    if (data.audio) {
      try {
        const entry = await addHistory(prompt, data.audio, data.lyrics ?? null)
        audioUrl = entry.audioUrl ? `${baseUrl}${entry.audioUrl}` : ''
        if (audioUrl) await sendAudio(senderId, audioUrl, token)
      } catch {
        // If audio send fails, continue to lyrics
      }
    }

    if (data.lyrics) {
      const formatted = formatLyricsForMessenger(data.lyrics)
      if (formatted) {
        await sendText(senderId, `🎶 Paroles générées :\n\n${formatted}`, token)
      }
    }

    if (!data.audio && !data.lyrics) {
      await sendText(senderId, '⚠️ Le modèle n\'a rien retourné. Réessaie.', token)
      return
    }

    await sendText(senderId, "✅ Vita ! Alefaso 'Recommencer' raha hamorona hira vaovao.", token)
    success = true
  } catch (err) {
    await sendText(senderId, `❌ Erreur : ${err instanceof Error ? err.message : 'Inconnue'}`, token)
  }

  // Mark payment as used ONLY after successful generation
  if (success && state.paymentId) {
    await markPaymentUsed(state.paymentId)
  }
  conversations.delete(senderId)
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleMessage(senderId: string, msgText: string, qrPayload: string | null, token: string, baseUrl: string) {
  const reply = (qrPayload ?? msgText).trim()
  const replyLower = reply.toLowerCase()

  // Reset triggers
  if (['recommencer', 'restart', 'start', 'bonjour', 'salut', 'hello', 'menu', 'Salama', 'début'].includes(replyLower)) {
    conversations.delete(senderId)
  }

  // New conversation
  if (!conversations.has(senderId)) {
    conversations.set(senderId, { step: 0, config: { ...DEFAULT_CONFIG }, waitingGenerate: false })
    await sendText(senderId, "🎵 Tonga soa eto amin'ny MozikAI ! Hanampy anao hamorona hira amin'ny alalan'ny fanontaniana vitsivitsy izahay.", token)
    await sendText(senderId, "Ity misy ohatra azonao henoina mba hahazoanao hevitra momba ny vokatra azo.", token)
    await sendMsg(senderId, {
      attachment: { type: 'audio', payload: { url: `${baseUrl}/api/audio/${PROMO_AUDIO_ID}`, is_reusable: true } },
    }, token)
    await sendStep(senderId, 0, token)
    return
  }

  const state = conversations.get(senderId)!

  // Waiting for "générer" confirmation (disabled – auto-generation only)
  if (state.waitingGenerate) {
    await generateAndSend(senderId, state, token, baseUrl)
    return
  }

  const currentStep = STEPS[state.step]
  const isSkip = reply === 'Passer' || replyLower === 'passer'

  // ── Payment step with phone normalization ──
  if (currentStep.key === 'payment') {
    let phone = msgText.trim()

    // 1. Remove all spaces, dashes, dots, parentheses
    phone = phone.replace(/[\s\-\.\(\)]/g, '')

    // 2. Handle +261 / 261 formats
    if (phone.startsWith('+261')) {
      phone = '0' + phone.substring(4)
    } else if (phone.startsWith('261')) {
      phone = '0' + phone.substring(3)
    } else if (phone.startsWith('03') && phone.length === 10) {
      // already correct format
    } else if (phone.length === 9 && phone.startsWith('3')) {
      phone = '0' + phone
    } else {
      await sendText(senderId, '❌ Misy diso ny laharana (numéro téléphone). Ampiasao endrika 034 XX XXX XX', token)
      return
    }

    // Final validation: must start with 034, 032, 033, 038, 039...
    if (!phone.match(/^03[2-9]\d{7}$/)) {
      await sendText(senderId, '❌ Misy diso ny laharana. Tokony hanomboka amin\'ny 034, 033, 032, 038, 039.', token)
      return
    }

    state.config.phone = phone

    const pending = await findPendingPayment(phone, 2500)
    if (!pending) {
      await sendText(senderId,
        '⏳ Mbola tsy nahay ny fanamarinana ny fandoavanao izahay.' +
        'Miandrasa kely ary alefaso indray ny laharanao (numéro nandoavanao).',
        token
      )
      return
    }

    // Store payment id but do NOT mark as used yet — only after successful generation
    state.paymentId = pending.id
    await sendText(senderId, '✅ Voamarina ny fandoavanao ! Manomboka ny famoronana hira... ⏳', token)

    // Generate automatically without waiting for "générer"
    await generateAndSend(senderId, state, token, baseUrl)
    return
  }

  // Store the answer
  if (currentStep.textInput) {
    // Lyrics step — free text OR skip
    state.config.lyrics = isSkip ? '' : msgText.trim()
  } else {
    // Quick reply step — use payload value
    if (!isSkip) state.config[currentStep.key] = reply
  }

  state.step++

  if (state.step < STEPS.length) {
    const nextStep = STEPS[state.step]
    if (nextStep.key === 'payment') {
      // Send payment instructions in separate messages
      await sendText(senderId, '💳 Mba hamitana ny hira, alefaso ny 2 500 Ar any amin\'ny 034 14 869 00 amin\'ny alalan\'ity code USSD eto ambany ity 👇', token)
      await sendText(senderId, '*111*1*2*0341486900*2500#', token)
      await sendText(senderId, nextStep.question, token)
    } else {
      await sendStep(senderId, state.step, token)
    }
  } else {
    // All steps done → generate automatically
    await sendText(senderId, '✅ Manomboka ny famoronana hira... ⏳', token)
    await generateAndSend(senderId, state, token, baseUrl)
  }
}

// ─── Signature verification ───────────────────────────────────────────────────

function verifySignature(body: string, signature: string | null, appSecret: string): boolean {
  if (!appSecret || !signature) return true // Skip if not configured
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(body).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const settings = await getSettings()
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === settings.verifyToken && settings.verifyToken) {
    return new Response(challenge ?? '', { status: 200 })
  }
  return new Response('Token de vérification invalide', { status: 403 })
}

export async function POST(req: NextRequest) {
  const settings = await getSettings()
  if (!settings.pageAccessToken) {
    return NextResponse.json({ error: 'Page Access Token non configuré' }, { status: 500 })
  }

  const rawBody = await req.text()

  // Verify signature if App Secret is configured
  const signature = req.headers.get('x-hub-signature-256')
  if (settings.appSecret && !verifySignature(rawBody, signature, settings.appSecret)) {
    return new Response('Signature invalide', { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  if (body.object !== 'page') {
    return NextResponse.json({ error: 'Pas un événement page' }, { status: 404 })
  }

  const baseUrl = getPublicBaseUrl(req)

  // Process events (acknowledge immediately, handle async)
  const entries = (body.entry as Array<{ messaging?: Array<{ sender?: { id: string }; message?: { text?: string; quick_reply?: { payload: string } } }> }>) ?? []

  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id
      if (!senderId || !event.message) continue

      const msgText = event.message.text ?? ''
      const qrPayload = event.message.quick_reply?.payload ?? null

      // Log every incoming message to Postgres
      logMessage(senderId, msgText, qrPayload).catch(err => console.error('[db] logMessage failed:', err))

      // Handle async — don't await here so we return 200 fast
      handleMessage(senderId, msgText, qrPayload, settings.pageAccessToken, baseUrl).catch(console.error)
    }
  }

  return NextResponse.json({ ok: true })
}
