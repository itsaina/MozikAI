import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import crypto from 'crypto'
import { initDb, logMessage } from '@/lib/db'

// ─── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_PATH = join(process.cwd(), 'data', 'messenger-settings.json')

interface MessengerSettings {
  pageAccessToken: string
  verifyToken: string
  appSecret: string
}

function readSettings(): MessengerSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {
    return { pageAccessToken: '', verifyToken: '', appSecret: '' }
  }
}

// ─── Music config & prompt builder ───────────────────────────────────────────

interface MusicConfig {
  genre: string
  era: string
  tempo: string
  instrument: string
  dynamics: string
  vocals: string
  lyrics: string
}

const DEFAULT_CONFIG: MusicConfig = {
  genre: '', era: '', tempo: '', instrument: '', dynamics: '', vocals: '', lyrics: '',
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
const GENRE_MAP: Record<string, string> = { 'Électro': 'Electronic', 'Classique': 'Classical' }

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
    const lines = c.lyrics.trim().split('\n').filter(Boolean).join(' / ')
    prompt += `\n\nLyrics: ${lines}`
  }
  return prompt
}

// ─── Conversation steps ───────────────────────────────────────────────────────

interface QR { title: string; payload: string }
interface Step { key: keyof MusicConfig; question: string; quickReplies: QR[]; textInput?: boolean }

const STEPS: Step[] = [
  {
    key: 'genre', question: 'Quel genre tu vises ?',
    quickReplies: [
      { title: 'Hip-Hop', payload: 'Hip-Hop' }, { title: 'Jazz', payload: 'Jazz' },
      { title: 'Rock', payload: 'Rock' }, { title: 'Pop', payload: 'Pop' },
      { title: 'Électro', payload: 'Électro' }, { title: 'R&B', payload: 'R&B' },
      { title: 'Classique', payload: 'Classique' }, { title: 'Folk', payload: 'Folk' },
      { title: 'Country', payload: 'Country' }, { title: 'K-Pop', payload: 'K-Pop' },
      { title: 'Funk', payload: 'Funk' }, { title: 'Soul', payload: 'Soul' },
      { title: 'Passer', payload: 'Passer' },
    ],
  },
  {
    key: 'era', question: 'Une époque en particulier ?',
    quickReplies: [
      { title: '1950s', payload: '1950s' }, { title: '1960s', payload: '1960s' },
      { title: '1970s', payload: '1970s' }, { title: '1980s', payload: '1980s' },
      { title: '1990s', payload: '1990s' }, { title: '2000s', payload: '2000s' },
      { title: '2010s', payload: '2010s' }, { title: '2020s', payload: '2020s' },
      { title: 'Contemporain', payload: 'Contemporain' },
      { title: 'Avant 1950', payload: 'Avant 1950' },
      { title: 'Passer', payload: 'Passer' },
    ],
  },
  {
    key: 'tempo', question: 'Quel tempo tu cherches ?',
    quickReplies: [
      { title: 'Très lent', payload: 'Très lent' }, { title: 'Lent', payload: 'Lent' },
      { title: 'Modéré', payload: 'Modéré' }, { title: 'Entraînant', payload: 'Entraînant' },
      { title: 'Rapide', payload: 'Rapide' }, { title: 'Très rapide', payload: 'Très rapide' },
      { title: 'Passer', payload: 'Passer' },
    ],
  },
  {
    key: 'instrument', question: 'Quel son doit dominer ?',
    quickReplies: [
      { title: 'Guitare', payload: 'Guitare' }, { title: 'Piano', payload: 'Piano' },
      { title: 'Synthés', payload: 'Synthés' }, { title: 'Cordes', payload: 'Cordes' },
      { title: 'Cuivres', payload: 'Cuivres' }, { title: 'Batterie', payload: 'Batterie' },
      { title: 'Basse', payload: 'Basse' }, { title: 'Groupe complet', payload: 'Groupe complet' },
      { title: 'Passer', payload: 'Passer' },
    ],
  },
  {
    key: 'dynamics', question: "Comment l'énergie doit évoluer ?",
    quickReplies: [
      { title: 'Monte au refrain', payload: 'Monte vers le refrain' },
      { title: 'Puissance constante', payload: 'Puissance constante' },
      { title: 'Couplets calmes', payload: 'Couplets calmes' },
      { title: 'Descend en douceur', payload: 'Descend en douceur' },
      { title: 'Voix tardive', payload: 'Voix tardive' },
      { title: 'Calme', payload: 'Calme du début à la fin' },
      { title: 'Passer', payload: 'Passer' },
    ],
  },
  {
    key: 'vocals', question: 'Quel type de voix ?',
    quickReplies: [
      { title: 'Voix masculine', payload: 'Voix masculine' },
      { title: 'Voix féminine', payload: 'Voix féminine' },
      { title: 'Voix mixtes', payload: 'Voix mixtes' },
      { title: 'Instrumental', payload: 'Instrumental' },
      { title: 'Passer', payload: 'Passer' },
    ],
  },
  {
    key: 'lyrics',
    question: "Des paroles ? Envoie-les en message libre.\nSinon tape 'Passer' — Lyria les inventera.",
    quickReplies: [{ title: 'Passer', payload: 'Passer' }],
    textInput: true,
  },
]

// ─── Conversation state (in-memory) ─────────────────────────────────────────

interface ConvState {
  step: number
  config: MusicConfig
  waitingGenerate: boolean
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
  return sendMsg(recipientId, {
    attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } },
  }, token)
}

async function sendStep(recipientId: string, stepIdx: number, token: string) {
  const step = STEPS[stepIdx]
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

// ─── Generate music via internal API ─────────────────────────────────────────

async function generateAndSend(senderId: string, state: ConvState, token: string, baseUrl: string) {
  const prompt = buildPrompt(state.config)
  await sendText(senderId, '🎵 Composition en cours… (30 à 60 secondes)', token)

  try {
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    })
    const data = (await res.json()) as { audio?: string; lyrics?: string; error?: string }

    if (!res.ok || data.error) {
      await sendText(senderId, `❌ Erreur : ${data.error ?? 'Génération échouée'}`, token)
      return
    }

    // Save audio file if present
    if (data.audio) {
      try {
        const dir = join(process.cwd(), 'public', 'generations')
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        const id = Date.now().toString()
        const base64 = data.audio.replace(/^data:audio\/\w+;base64,/, '')
        writeFileSync(join(dir, `${id}.mp3`), Buffer.from(base64, 'base64'))
        const audioUrl = `${baseUrl}/generations/${id}.mp3`
        await sendAudio(senderId, audioUrl, token)
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

    await sendText(senderId, "✅ C'est terminé ! Envoie 'recommencer' pour créer une nouvelle chanson.", token)
  } catch (err) {
    await sendText(senderId, `❌ Erreur : ${err instanceof Error ? err.message : 'Inconnue'}`, token)
  }

  conversations.delete(senderId)
}

// ─── Message handler ──────────────────────────────────────────────────────────

async function handleMessage(senderId: string, msgText: string, qrPayload: string | null, token: string, baseUrl: string) {
  const reply = (qrPayload ?? msgText).trim()
  const replyLower = reply.toLowerCase()

  // Reset triggers
  if (['recommencer', 'restart', 'start', 'bonjour', 'salut', 'hello', 'menu', 'début'].includes(replyLower)) {
    conversations.delete(senderId)
  }

  // New conversation
  if (!conversations.has(senderId)) {
    conversations.set(senderId, { step: 0, config: { ...DEFAULT_CONFIG }, waitingGenerate: false })
    await sendText(senderId, "🎵 Bienvenue sur MozikAI ! Je vais t'aider à composer une chanson en quelques questions.", token)
    await sendStep(senderId, 0, token)
    return
  }

  const state = conversations.get(senderId)!

  // Waiting for "générer" confirmation
  if (state.waitingGenerate) {
    if (['générer', 'generer', 'oui', 'go', 'lancer', 'ok'].includes(replyLower)) {
      state.waitingGenerate = false
      await generateAndSend(senderId, state, token, baseUrl)
    } else {
      await sendText(senderId, "Envoie 'générer' pour lancer la composition, ou 'recommencer' pour tout refaire.", token)
    }
    return
  }

  const currentStep = STEPS[state.step]
  const isSkip = reply === 'Passer' || replyLower === 'passer'

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
    await sendStep(senderId, state.step, token)
  } else {
    // All steps done
    const prompt = buildPrompt(state.config)
    state.waitingGenerate = true
    await sendText(senderId,
      `✅ Tout est configuré !\n\nPrompt :\n${prompt}\n\nEnvoie 'générer' pour lancer la composition, ou 'recommencer' pour tout refaire.`,
      token
    )
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
  const settings = readSettings()
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
  const settings = readSettings()
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

  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`

  // Process events (acknowledge immediately, handle async)
  const entries = (body.entry as Array<{ messaging?: Array<{ sender?: { id: string }; message?: { text?: string; quick_reply?: { payload: string } } }> }>) ?? []

  for (const entry of entries) {
    for (const event of entry.messaging ?? []) {
      const senderId = event.sender?.id
      if (!senderId || !event.message) continue

      const msgText = event.message.text ?? ''
      const qrPayload = event.message.quick_reply?.payload ?? null

      // Log every incoming message to Postgres
      initDb()
        .then(() => logMessage(senderId, msgText, qrPayload))
        .catch(err => console.error('[db] logMessage failed:', err))

      // Handle async — don't await here so we return 200 fast
      handleMessage(senderId, msgText, qrPayload, settings.pageAccessToken, baseUrl).catch(console.error)
    }
  }

  return NextResponse.json({ ok: true })
}
