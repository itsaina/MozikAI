import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  const { prompt } = await req.json()

  if (!prompt?.trim()) {
    return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 })
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'MozikAI',
      },
      body: JSON.stringify({
        model: 'google/lyria-3-pro-preview',
        messages: [{ role: 'user', content: prompt }],
        modalities: ['audio'],
        audio: { format: 'mp3' },
        stream: true,
      }),
    })

    if (!res.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw: any = await res.json()
      const msg = raw?.error?.message ?? raw?.message ?? `HTTP ${res.status}`
      return NextResponse.json({ error: msg }, { status: res.status })
    }

    // Collect all SSE chunks and find the last complete message
    const text = await res.text()
    console.log('[generate] raw SSE length:', text.length)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lastChunk: any = null
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
      try {
        const parsed = JSON.parse(line.slice(6))
        if (parsed?.choices?.[0]?.delta?.audio?.data || parsed?.choices?.[0]?.message) {
          lastChunk = parsed
        }
        // Keep merging audio data across chunks
        if (parsed?.choices?.[0]?.delta?.audio?.data) {
          if (!lastChunk) lastChunk = parsed
          else {
            lastChunk.choices[0].delta ??= {}
            lastChunk.choices[0].delta.audio ??= {}
            lastChunk.choices[0].delta.audio.data =
              (lastChunk.choices[0].delta.audio.data ?? '') + parsed.choices[0].delta.audio.data
          }
        }
      } catch { /* skip malformed lines */ }
    }

    console.log('[generate] lastChunk delta keys:', Object.keys(lastChunk?.choices?.[0]?.delta ?? {}))

    // Normalize: streaming uses `delta`, non-streaming uses `message`
    const message = lastChunk?.choices?.[0]?.message ?? lastChunk?.choices?.[0]?.delta

    // Try every known location for audio data
    let audioContent: string | null = null

    if (message?.audio?.data) {
      // Base64 encoded audio
      const fmt: string = message.audio.format ?? 'mp3'
      audioContent = `data:audio/${fmt};base64,${message.audio.data}`
    } else if (message?.audio?.url) {
      audioContent = message.audio.url as string
    } else if (
      typeof message?.content === 'string' &&
      (message.content.startsWith('http') || message.content.startsWith('data:audio'))
    ) {
      audioContent = message.content as string
    }

    // Text content (lyrics + structure)
    const textContent: string | null =
      typeof message?.content === 'string' && !audioContent ? (message.content as string) : null

    if (!audioContent && !textContent) {
      console.warn('[generate] nothing usable in response')
      return NextResponse.json({ error: 'Model returned no content', raw }, { status: 502 })
    }

    return NextResponse.json({ audio: audioContent, lyrics: textContent })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    console.error('[generate]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
