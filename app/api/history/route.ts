import { NextRequest, NextResponse } from 'next/server'
import { getHistory, addHistory, deleteHistory } from '@/lib/store'

export interface HistoryEntry {
  id: string
  timestamp: string
  prompt: string
  audioUrl: string
  lyrics: string | null
}

export async function GET() {
  const entries = await getHistory()
  return NextResponse.json(entries)
}

export async function POST(req: NextRequest) {
  const { prompt, audio, lyrics } = (await req.json()) as {
    prompt: string
    audio: string | null
    lyrics: string | null
  }
  const entry = await addHistory(prompt, audio, lyrics)
  return NextResponse.json(entry)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await deleteHistory(id)
  return NextResponse.json({ ok: true })
}
