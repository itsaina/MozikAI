import { NextRequest } from 'next/server'
import { getAudioBase64 } from '@/lib/store'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await params
  const id = rawId.replace(/\.mp3$/i, '')
  const base64 = await getAudioBase64(id)

  if (!base64) {
    return new Response('Not found', { status: 404 })
  }

  const raw = base64.startsWith('data:') ? base64.split(',')[1] : base64
  const buffer = Buffer.from(raw, 'base64')

  return new Response(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `inline; filename="${id}.mp3"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
