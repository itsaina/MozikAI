import { NextRequest } from 'next/server'
import { getAudioBase64 } from '@/lib/store'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const base64 = await getAudioBase64(id)

  if (!base64) {
    return new Response('Not found', { status: 404 })
  }

  const buffer = Buffer.from(base64, 'base64')

  return new Response(buffer, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
