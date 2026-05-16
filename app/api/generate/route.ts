import { NextRequest, NextResponse } from 'next/server'
import { generateMusic } from '@/lib/generate'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const { prompt } = await req.json()

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  try {
    const result = await generateMusic(prompt)
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    console.error('[generate]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
