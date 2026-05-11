import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join } from 'path'

const DIR = join(process.cwd(), 'public', 'generations')
const INDEX = join(DIR, 'index.json')

export interface HistoryEntry {
  id: string
  timestamp: string
  prompt: string
  audioUrl: string
  lyrics: string | null
}

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
}

function readIndex(): HistoryEntry[] {
  try {
    return JSON.parse(readFileSync(INDEX, 'utf-8'))
  } catch {
    return []
  }
}

function writeIndex(entries: HistoryEntry[]) {
  writeFileSync(INDEX, JSON.stringify(entries, null, 2))
}

export async function GET() {
  ensureDir()
  return NextResponse.json(readIndex())
}

export async function POST(req: NextRequest) {
  ensureDir()
  const { prompt, audio, lyrics } = (await req.json()) as {
    prompt: string
    audio: string | null
    lyrics: string | null
  }

  const id = Date.now().toString()
  let audioUrl = ''

  if (audio) {
    const base64 = audio.replace(/^data:audio\/\w+;base64,/, '')
    const buffer = Buffer.from(base64, 'base64')
    writeFileSync(join(DIR, `${id}.mp3`), buffer)
    audioUrl = `/generations/${id}.mp3`
  }

  const entry: HistoryEntry = {
    id,
    timestamp: new Date().toISOString(),
    prompt,
    audioUrl,
    lyrics: lyrics ?? null,
  }

  writeIndex([entry, ...readIndex()])
  return NextResponse.json(entry)
}

export async function DELETE(req: NextRequest) {
  ensureDir()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const entries = readIndex()
  const entry = entries.find(e => e.id === id)

  if (entry?.audioUrl) {
    try {
      unlinkSync(join(process.cwd(), 'public', entry.audioUrl))
    } catch { /* already gone */ }
  }

  writeIndex(entries.filter(e => e.id !== id))
  return NextResponse.json({ ok: true })
}
