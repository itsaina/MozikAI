import { NextRequest, NextResponse } from 'next/server'
import { getSettings, saveSettings } from '@/lib/store'

export interface MessengerSettings {
  pageAccessToken: string
  verifyToken: string
  appSecret: string
}

export async function GET() {
  const settings = await getSettings()
  return NextResponse.json(settings)
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as MessengerSettings
  await saveSettings(body)
  return NextResponse.json({ ok: true })
}
