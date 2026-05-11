'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MusicConfig {
  genre: string
  era: string
  tempo: string
  instrument: string
  dynamics: string
  vocals: string
  lyrics: string
}

interface HistoryEntry {
  id: string
  timestamp: string
  prompt: string
  audioUrl: string
  lyrics: string | null
}

interface ChatMsg {
  id: number
  type: 'bot' | 'user'
  text: string
}

const DEFAULT_CONFIG: MusicConfig = {
  genre: '', era: '', tempo: '', instrument: '', dynamics: '', vocals: '', lyrics: '',
}

// ─── Steps (en français) ──────────────────────────────────────────────────────

interface StepDef {
  key: keyof MusicConfig
  question: string
  quickReplies: string[]
  textInput?: boolean
}

const STEPS: StepDef[] = [
  {
    key: 'genre',
    question: 'Quel genre tu vises ?',
    quickReplies: ['Hip-Hop', 'Jazz', 'Rock', 'Pop', 'Électro', 'R&B', 'Classique', 'Folk', 'Country', 'K-Pop', 'Funk', 'Soul', 'Passer'],
  },
  {
    key: 'era',
    question: 'Une époque en particulier ?',
    quickReplies: ['1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s', 'Contemporain', 'Avant 1950', 'Passer'],
  },
  {
    key: 'tempo',
    question: 'Quel tempo tu cherches ?',
    quickReplies: ['Très lent', 'Lent', 'Modéré', 'Entraînant', 'Rapide', 'Très rapide', 'Passer'],
  },
  {
    key: 'instrument',
    question: 'Quel son doit dominer ?',
    quickReplies: ['Guitare', 'Piano', 'Synthés', 'Cordes', 'Cuivres', 'Batterie', 'Basse', 'Groupe complet', 'Passer'],
  },
  {
    key: 'dynamics',
    question: "Comment l'énergie doit évoluer ?",
    quickReplies: ['Monte vers le refrain', 'Puissance constante', 'Couplets calmes', 'Descend en douceur', 'Voix tardive', 'Calme du début à la fin', 'Passer'],
  },
  {
    key: 'vocals',
    question: 'Quel type de voix ?',
    quickReplies: ['Voix masculine', 'Voix féminine', 'Voix mixtes', 'Instrumental', 'Passer'],
  },
  {
    key: 'lyrics',
    question: "Tu as des paroles ? Écris-les en bas — ou passe et Lyria les inventera.",
    quickReplies: ['Passer — Lyria s\'en charge'],
    textInput: true,
  },
]

// ─── Prompt builder (prompt en anglais pour l'IA) ─────────────────────────────

const TEMPO_MAP: Record<string, string> = {
  'Très lent': 'very slow tempo (40–60 BPM)',
  'Lent': 'slow tempo (60–80 BPM)',
  'Modéré': 'moderate tempo (80–100 BPM)',
  'Entraînant': 'upbeat tempo (100–120 BPM)',
  'Rapide': 'fast tempo (120–140 BPM)',
  'Très rapide': 'very fast tempo (140+ BPM)',
}

const INSTRUMENT_MAP: Record<string, string> = {
  'Guitare': 'featuring guitar',
  'Piano': 'featuring piano',
  'Synthés': 'featuring synthesizers',
  'Cordes': 'featuring strings',
  'Cuivres': 'featuring brass and horns',
  'Batterie': 'drums-forward',
  'Basse': 'heavy bass',
  'Groupe complet': 'full band arrangement',
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
  'Voix masculine': 'male vocalist',
  'Voix féminine': 'female vocalist',
  'Voix mixtes': 'male and female vocalists in harmony',
  'Instrumental': 'purely instrumental, no vocals',
}

const GENRE_MAP: Record<string, string> = {
  'Électro': 'Electronic',
  'Classique': 'Classical',
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
    const lines = c.lyrics.trim().split('\n').filter(Boolean).join(' / ')
    prompt += `\n\nLyrics: ${lines}`
  }
  return prompt
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function MAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center text-[11px] font-bold flex-shrink-0 select-none">
      M
    </div>
  )
}

// ─── Typing indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-2 mt-3">
      <MAvatar />
      <div className="bg-[#3A3B3C] rounded-[18px] rounded-bl-[4px] px-4 py-3 flex items-center gap-[5px]">
        <div className="w-2 h-2 rounded-full bg-gray-400 typing-dot" style={{ animationDelay: '0ms' }} />
        <div className="w-2 h-2 rounded-full bg-gray-400 typing-dot" style={{ animationDelay: '180ms' }} />
        <div className="w-2 h-2 rounded-full bg-gray-400 typing-dot" style={{ animationDelay: '360ms' }} />
      </div>
    </div>
  )
}

// ─── Quick Reply Bar ──────────────────────────────────────────────────────────

function QuickReplyBar({ replies, onSelect }: { replies: string[]; onSelect: (r: string) => void }) {
  return (
    <div className="bg-black border-t border-[#2A2A2A] relative">
      <div className="flex gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
        {replies.map(r => {
          const isSkip = r === 'Passer' || r.startsWith('Passer')
          return (
            <button
              key={r}
              onClick={() => onSelect(r)}
              className={`flex-shrink-0 px-4 py-[7px] rounded-full text-[14px] font-medium border-[1.5px] transition-colors whitespace-nowrap ${
                isSkip
                  ? 'border-gray-600 text-gray-500 hover:border-gray-500 hover:text-gray-400'
                  : 'border-[#0084FF] text-[#0084FF] hover:bg-[#0084FF]/10'
              }`}
            >
              {r}
            </button>
          )
        })}
      </div>
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-black to-transparent pointer-events-none" />
    </div>
  )
}

// ─── Audio player ─────────────────────────────────────────────────────────────

function AudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const ref = useRef<HTMLAudioElement>(null)

  const toggle = () => {
    if (!ref.current) return
    playing ? ref.current.pause() : void ref.current.play()
    setPlaying(p => !p)
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const progress = duration > 0 ? time / duration : 0

  return (
    <div className="p-4 rounded-2xl bg-[#1C1C1E] border border-[#3A3B3C]">
      <p className="text-[11px] text-gray-500 mb-3 uppercase tracking-wider font-semibold">Audio généré</p>
      <audio
        ref={ref}
        src={src}
        onTimeUpdate={() => setTime(ref.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(ref.current?.duration ?? 0)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-4">
        <button
          onClick={toggle}
          className="w-11 h-11 rounded-full bg-[#0084FF] hover:bg-[#0090FF] active:scale-95 flex items-center justify-center text-white transition-all flex-shrink-0"
        >
          {playing ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="flex-1">
          <div className="flex items-end gap-0.5 h-7 mb-2">
            {Array.from({ length: 36 }).map((_, i) => {
              const h = 4 + Math.abs(Math.sin(i * 0.9) * 14 + Math.cos(i * 0.45) * 7)
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-full ${playing ? 'bg-[#0084FF] wave-bar' : 'bg-[#0084FF]/30'}`}
                  style={{
                    height: `${h}px`,
                    animationDuration: playing ? `${0.35 + (i % 6) * 0.08}s` : undefined,
                    animationDelay: playing ? `${(i % 5) * 0.06}s` : undefined,
                  }}
                />
              )
            })}
          </div>
          <div
            className="relative h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer"
            onClick={e => {
              if (!ref.current || !duration) return
              const rect = (e.target as HTMLElement).getBoundingClientRect()
              ref.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-[#0084FF] rounded-full" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="flex justify-between text-[12px] text-gray-500 mt-1.5">
            <span>{fmt(time)}</span>
            <span>{duration ? fmt(duration) : '--:--'}</span>
          </div>
        </div>
        <a
          href={src}
          download="mozikai.mp3"
          className="w-9 h-9 rounded-full bg-[#3A3B3C] hover:bg-[#4A4B4C] flex items-center justify-center text-gray-400 hover:text-white transition-all"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </a>
      </div>
    </div>
  )
}

// ─── Lyria result ─────────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = { A: 'Intro', B: 'Couplet', C: 'Refrain', D: 'Pont', E: 'Outro' }
interface ParsedLine { text: string; backing: boolean }
interface ParsedSection { id: string; label: string; lines: ParsedLine[]; descLines: string[] }

function parseLyria(raw: string) {
  const bpm = raw.match(/\nbpm:\s*([\d.]+)/)?.[1]
  const dur = raw.match(/\nduration_secs:\s*([\d.]+)/)?.[1]
  const metaIdx = raw.indexOf('\nmosic:')
  const lyricsRaw = metaIdx > 0 ? raw.slice(0, metaIdx) : raw
  const afterMeta = metaIdx > 0 ? raw.slice(metaIdx) : ''
  const descStart = afterMeta.indexOf('\n[[')
  const descRaw = descStart > 0 ? afterMeta.slice(descStart + 1) : ''

  function parseParts(text: string, isDesc: boolean): ParsedSection[] {
    const sections: ParsedSection[] = []
    let cur: ParsedSection | null = null
    for (const line of text.split('\n')) {
      const sm = line.match(/^\[\[([A-Z])(\d+)\]\]$/)
      if (sm) {
        if (cur) sections.push(cur)
        cur = { id: `${sm[1]}${sm[2]}`, label: `${SECTION_LABELS[sm[1]] ?? sm[1]}${parseInt(sm[2]) > 0 ? ' ' + sm[2] : ''}`, lines: [], descLines: [] }
        continue
      }
      const lm = line.match(/^\[[\d.]*:?\]\s*(.+)$/)
      if (lm && cur) {
        const t = lm[1].trim()
        if (!t) continue
        if (isDesc) cur.descLines.push(t)
        else {
          const backing = t.startsWith('(') && t.endsWith(')')
          cur.lines.push({ text: backing ? t.slice(1, -1) : t, backing })
        }
      }
    }
    if (cur) sections.push(cur)
    return sections
  }

  const lyricSections = parseParts(lyricsRaw, false).filter(s => s.lines.length > 0)
  const descSections = parseParts(descRaw, true).filter(s => s.descLines.length > 0)
  const descMap = Object.fromEntries(descSections.map(s => [s.id, s.descLines]))
  const merged = lyricSections.map(s => ({ ...s, descLines: descMap[s.id] ?? [] }))
  return {
    bpm: bpm ? Math.round(parseFloat(bpm)) : null,
    duration: dur ? parseFloat(dur) : null,
    sections: merged,
    hasContent: merged.length > 0,
  }
}

function fmtDur(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

function LyriaResult({ content }: { content: string }) {
  const [showDesc, setShowDesc] = useState(false)
  const [copied, setCopied] = useState(false)
  const parsed = parseLyria(content)

  const copyLyrics = () => {
    const txt = parsed.sections
      .map(s => `— ${s.label} —\n${s.lines.map(l => (l.backing ? `(${l.text})` : l.text)).join('\n')}`)
      .join('\n\n')
    void navigator.clipboard.writeText(txt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!parsed.hasContent) {
    return (
      <div className="mt-3 p-4 rounded-2xl bg-[#1C1C1E] border border-[#3A3B3C]">
        <p className="text-[11px] text-gray-500 mb-2 uppercase tracking-wider font-semibold">Réponse Lyria</p>
        <pre className="text-[13px] text-gray-400 whitespace-pre-wrap leading-relaxed overflow-auto max-h-64">{content}</pre>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-2xl border border-[#3A3B3C] bg-[#1C1C1E] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#3A3B3C] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Chanson générée</span>
          {parsed.bpm && <span className="text-[12px] text-[#0084FF] font-mono">{parsed.bpm} BPM</span>}
          {parsed.duration && <span className="text-[12px] text-gray-500 font-mono">{fmtDur(parsed.duration)}</span>}
        </div>
        <button onClick={copyLyrics} className="text-[12px] text-gray-500 hover:text-white transition-colors">
          {copied ? '✓ Copié' : 'Copier les paroles'}
        </button>
      </div>
      <div className="px-4 py-4 space-y-5 overflow-y-auto max-h-[28rem]">
        {parsed.sections.map(section => (
          <div key={section.id}>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#0084FF]/70 mb-2">{section.label}</p>
            <div className="space-y-1">
              {section.lines.map((line, i) => (
                <p key={i} className={`text-[14px] leading-relaxed ${line.backing ? 'text-gray-500 italic pl-4' : 'text-gray-100'}`}>
                  {line.text}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
      {parsed.sections.some(s => s.descLines.length > 0) && (
        <div className="border-t border-[#3A3B3C]">
          <button
            onClick={() => setShowDesc(d => !d)}
            className="w-full px-4 py-3 text-[12px] text-gray-600 hover:text-gray-400 text-left flex items-center gap-1.5 transition-colors"
          >
            <span>{showDesc ? '▲' : '▼'}</span>
            <span>Notes de direction musicale</span>
          </button>
          {showDesc && (
            <div className="px-4 pb-4 space-y-4 overflow-y-auto max-h-64">
              {parsed.sections.filter(s => s.descLines.length > 0).map(section => (
                <div key={section.id}>
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-[#0084FF]/70 mb-1">{section.label}</p>
                  <p className="text-[12px] text-gray-500 leading-relaxed">{section.descLines.join(' ')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Historique ───────────────────────────────────────────────────────────────

function fmtAge(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'à l\'instant'
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`
  return new Date(iso).toLocaleDateString('fr-FR')
}

function HistoryPanel({ entries, onDelete }: { entries: HistoryEntry[]; onDelete: (id: string) => void }) {
  const [open, setOpen] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  if (entries.length === 0) return null
  return (
    <div className="rounded-2xl border border-[#3A3B3C] bg-[#1C1C1E] overflow-hidden mt-4">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Historique ({entries.length})</span>
        <span className="text-gray-600 text-[11px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="divide-y divide-[#3A3B3C]">
          {entries.map(entry => (
            <div key={entry.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-gray-500 mb-1">{fmtAge(entry.timestamp)}</p>
                  <p className="text-[14px] text-gray-300 leading-snug line-clamp-2">{entry.prompt}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {entry.audioUrl && (
                    <button
                      onClick={() => setExpanded(e => (e === entry.id ? null : entry.id))}
                      className="w-8 h-8 rounded-full bg-[#0084FF]/20 hover:bg-[#0084FF]/40 border border-[#0084FF]/40 flex items-center justify-center text-[#0084FF] transition-all"
                    >
                      {expanded === entry.id ? (
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                      ) : (
                        <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                      )}
                    </button>
                  )}
                  <a href={entry.audioUrl} download className="w-8 h-8 rounded-full bg-[#3A3B3C] hover:bg-[#4A4B4C] flex items-center justify-center text-gray-400 hover:text-white transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                  </a>
                  <button onClick={() => onDelete(entry.id)} className="w-8 h-8 rounded-full bg-[#3A3B3C] hover:bg-red-900/40 flex items-center justify-center text-gray-500 hover:text-red-400 transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {expanded === entry.id && entry.audioUrl && (
                <div className="mt-3">
                  <AudioPlayer src={entry.audioUrl} />
                  {entry.lyrics && <LyriaResult content={entry.lyrics} />}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Home ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: 0, type: 'bot', text: STEPS[0].question },
  ])
  const [step, setStep] = useState(0)
  const [config, setConfig] = useState<MusicConfig>(DEFAULT_CONFIG)
  const [done, setDone] = useState(false)
  const [botTyping, setBotTyping] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [lyricsResult, setLyricsResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [lyricsInput, setLyricsInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const lyricsRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, done, audioUrl, lyricsResult, botTyping])

  useEffect(() => {
    fetch('/api/history')
      .then(r => r.json())
      .then((data: HistoryEntry[]) => setHistory(data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (step === STEPS.length - 1 && !done) {
      setTimeout(() => lyricsRef.current?.focus(), 150)
    }
  }, [step, done])

  const advanceStep = useCallback((userText: string, configPatch: Partial<MusicConfig>) => {
    const nextStep = step + 1
    const userMsg: ChatMsg = { id: Date.now(), type: 'user', text: userText }
    setConfig(prev => ({ ...prev, ...configPatch }))

    if (nextStep < STEPS.length) {
      setMessages(prev => [...prev, userMsg])
      setBotTyping(true)
      setTimeout(() => {
        const botMsg: ChatMsg = { id: Date.now() + 1, type: 'bot', text: STEPS[nextStep].question }
        setMessages(prev => [...prev, botMsg])
        setBotTyping(false)
        setStep(nextStep)
      }, 750)
    } else {
      setMessages(prev => [...prev, userMsg])
      setDone(true)
    }
  }, [step])

  const handleQRSelect = useCallback((reply: string) => {
    const stepDef = STEPS[step]
    const isSkip = reply === 'Passer' || reply.startsWith('Passer')

    if (stepDef.textInput) {
      advanceStep('Lyria s\'en charge', { lyrics: '' })
    } else {
      advanceStep(isSkip ? 'Passer' : reply, { [stepDef.key]: isSkip ? '' : reply })
    }
  }, [step, advanceStep])

  const submitLyrics = useCallback(() => {
    const lines = lyricsInput.trim().split('\n').filter(Boolean)
    const summary = lines.length > 0
      ? lines[0] + (lines.length > 1 ? ' ...' : '')
      : "Lyria s'en charge"
    advanceStep(summary, { lyrics: lyricsInput })
    setLyricsInput('')
  }, [lyricsInput, advanceStep])

  const saveToHistory = useCallback(async (prompt: string, audio: string | null, lyrics: string | null) => {
    try {
      const res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, audio, lyrics }),
      })
      const entry = (await res.json()) as HistoryEntry
      setHistory(prev => [entry, ...prev])
      setCurrentId(entry.id)
    } catch { /* non-blocking */ }
  }, [])

  const deleteFromHistory = useCallback(async (id: string) => {
    setHistory(prev => prev.filter(e => e.id !== id))
    await fetch(`/api/history?id=${id}`, { method: 'DELETE' }).catch(() => {})
  }, [])

  const prompt = buildPrompt(config)

  const generate = async () => {
    setGenerating(true)
    setError(null)
    setAudioUrl(null)
    setLyricsResult(null)
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const data = (await res.json()) as { audio?: string; lyrics?: string; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Génération échouée')
      if (!data.audio && !data.lyrics) throw new Error('Le modèle n\'a rien retourné')
      setAudioUrl(data.audio ?? null)
      setLyricsResult(data.lyrics ?? null)
      void saveToHistory(prompt, data.audio ?? null, data.lyrics ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue')
    } finally {
      setGenerating(false)
    }
  }

  const restart = () => {
    setMessages([{ id: Date.now(), type: 'bot', text: STEPS[0].question }])
    setStep(0)
    setConfig(DEFAULT_CONFIG)
    setDone(false)
    setBotTyping(false)
    setAudioUrl(null)
    setLyricsResult(null)
    setError(null)
    setCurrentId(null)
    setLyricsInput('')
  }

  const isLyricsStep = step === STEPS.length - 1 && !done && !botTyping
  const showQR = !done && !botTyping && STEPS[step]?.quickReplies.length > 0

  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <header className="bg-[#1C1C1E] border-b border-[#3A3B3C] flex-shrink-0">
        <div className="max-w-[640px] mx-auto px-4 py-2.5 flex items-center gap-3">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center font-bold text-base select-none">
              M
            </div>
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-[#1C1C1E]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[15px] leading-tight">MozikAI</p>
            <p className="text-[12px] text-[#0084FF] leading-tight">En ligne · Lyria 3 Pro</p>
          </div>
          <div className="flex items-center gap-1">
            <button className="w-9 h-9 rounded-full bg-[#3A3B3C] flex items-center justify-center text-[#0084FF] hover:bg-[#4A4B4C] transition-colors">
              <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
              </svg>
            </button>
            <button className="w-9 h-9 rounded-full bg-[#3A3B3C] flex items-center justify-center text-[#0084FF] hover:bg-[#4A4B4C] transition-colors">
              <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
              </svg>
            </button>
            <button onClick={restart} title="Nouvelle conversation" className="w-9 h-9 rounded-full bg-[#3A3B3C] flex items-center justify-center text-[#0084FF] hover:bg-[#4A4B4C] transition-colors">
              <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
              </svg>
            </button>
            <Link href="/messenger" title="Intégration Messenger" className="w-9 h-9 rounded-full bg-[#3A3B3C] flex items-center justify-center text-[#0084FF] hover:bg-[#4A4B4C] transition-colors">
              <svg className="w-[18px] h-[18px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.917 1.44 5.524 3.7 7.23v3.527l3.397-1.868c.908.252 1.868.388 2.903.388 5.523 0 10-4.145 10-9.277S17.523 2 12 2zm1.044 12.488l-2.548-2.717-4.973 2.717 5.473-5.808 2.61 2.717 4.91-2.717-5.472 5.808z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[640px] mx-auto px-4 pt-4 pb-2">

          {messages.map((msg, idx) => {
            const prevMsg = messages[idx - 1]
            const nextMsg = messages[idx + 1]
            const isFirstInGroup = !prevMsg || prevMsg.type !== msg.type
            const isLastInGroup = !nextMsg || nextMsg.type !== msg.type

            if (msg.type === 'user') {
              return (
                <div key={msg.id} className={`flex justify-end ${isFirstInGroup ? 'mt-3' : 'mt-[3px]'}`}>
                  <div className={`bg-[#0084FF] text-white px-4 py-[9px] max-w-[75%] ${
                    isLastInGroup ? 'rounded-[18px] rounded-br-[4px]' : 'rounded-[18px]'
                  }`}>
                    <p className="text-[15px] leading-[1.35] whitespace-pre-line">{msg.text}</p>
                  </div>
                </div>
              )
            }

            return (
              <div key={msg.id} className={`${isFirstInGroup ? 'mt-3' : 'mt-[3px]'}`}>
                <div className="flex items-end gap-2">
                  {isLastInGroup ? <MAvatar /> : <div className="w-7 flex-shrink-0" />}
                  <div className={`bg-[#3A3B3C] text-white px-4 py-[9px] max-w-[75%] ${
                    isLastInGroup ? 'rounded-[18px] rounded-bl-[4px]' : 'rounded-[18px]'
                  }`}>
                    <p className="text-[15px] leading-[1.35] whitespace-pre-line">{msg.text}</p>
                  </div>
                </div>
              </div>
            )
          })}

          {botTyping && <TypingIndicator />}

          {done && (
            <div className="mt-3">
              <div className="flex items-end gap-2">
                <MAvatar />
                <div className="bg-[#3A3B3C] text-white px-4 py-[9px] rounded-[18px] rounded-bl-[4px] max-w-[75%]">
                  <p className="text-[15px] leading-[1.35]">Tout est prêt ! Voilà ton prompt — appuie sur Générer quand tu veux.</p>
                </div>
              </div>

              <div className="ml-9 mt-3 space-y-3 pb-4">
                {prompt.trim() && (
                  <div className="rounded-2xl bg-[#1C1C1E] border border-[#3A3B3C] overflow-hidden">
                    <div className="px-4 py-2 border-b border-[#3A3B3C]">
                      <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Prompt</span>
                    </div>
                    <div className="px-4 py-3">
                      <pre className="text-[13px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">{prompt}</pre>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => void generate()}
                  disabled={generating || !prompt.trim()}
                  className="w-full py-4 rounded-2xl text-[15px] font-semibold bg-[#0084FF] hover:bg-[#0090FF] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-white"
                >
                  {generating ? (
                    <span className="flex items-center justify-center gap-2.5">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Composition en cours...
                    </span>
                  ) : 'Générer la musique'}
                </button>

                {error && (
                  <div className="px-4 py-3 rounded-2xl bg-red-900/20 border border-red-500/30 text-[14px] text-red-300">
                    {error}
                  </div>
                )}

                {audioUrl && <AudioPlayer src={audioUrl} />}
                {lyricsResult && <LyriaResult content={lyricsResult} />}

                <button
                  onClick={restart}
                  className="w-full py-3 rounded-2xl text-[14px] text-gray-500 hover:text-[#0084FF] border border-[#3A3B3C] hover:border-[#0084FF]/40 transition-all"
                >
                  Recommencer
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />

          {history.filter(e => e.id !== currentId).length > 0 && (
            <HistoryPanel
              entries={history.filter(e => e.id !== currentId)}
              onDelete={deleteFromHistory}
            />
          )}
        </div>
      </div>

      {/* ── Quick replies — au-dessus du composer ── */}
      {showQR && (
        <QuickReplyBar
          replies={STEPS[step].quickReplies}
          onSelect={handleQRSelect}
        />
      )}

      {/* ── Composer ── */}
      <div className="bg-[#1C1C1E] border-t border-[#3A3B3C] px-4 py-3 flex-shrink-0">
        <div className="max-w-[640px] mx-auto flex items-center gap-2">

          <button className="w-9 h-9 rounded-full flex items-center justify-center text-[#0084FF] hover:bg-[#3A3B3C] transition-colors flex-shrink-0">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
            </svg>
          </button>

          <div className={`flex-1 bg-[#3A3B3C] rounded-full flex items-center px-4 py-2 min-h-[40px] transition-all ${isLyricsStep ? 'ring-2 ring-[#0084FF]/30' : ''}`}>
            {isLyricsStep ? (
              <textarea
                ref={lyricsRef}
                rows={1}
                placeholder="Écris tes paroles ici..."
                value={lyricsInput}
                onChange={e => setLyricsInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submitLyrics()
                  }
                }}
                className="flex-1 bg-transparent text-[15px] text-white placeholder-gray-500 focus:outline-none resize-none leading-[1.35] max-h-28"
              />
            ) : (
              <span className="text-[15px] text-gray-600 select-none">
                {done ? 'Utilise le panneau ci-dessus...' : 'Choisis une option ci-dessus...'}
              </span>
            )}
          </div>

          {isLyricsStep ? (
            <button
              onClick={submitLyrics}
              className="w-9 h-9 rounded-full bg-[#0084FF] flex items-center justify-center text-white hover:bg-[#0090FF] transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4 translate-x-[1px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          ) : (
            <button className="w-9 h-9 rounded-full flex items-center justify-center text-[#0084FF] hover:bg-[#3A3B3C] transition-colors flex-shrink-0">
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M0 0h24v24H0z" fill="none" /><path d="M1 21l23-9L1 3v7l17 2-17 2v7z" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
