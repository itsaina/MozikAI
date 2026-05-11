import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), 'data')
const SETTINGS_PATH = join(DATA_DIR, 'messenger-settings.json')

export interface MessengerSettings {
  pageAccessToken: string
  verifyToken: string
  appSecret: string
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
}

function readSettings(): MessengerSettings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {
    return { pageAccessToken: '', verifyToken: '', appSecret: '' }
  }
}

export async function GET() {
  ensureDir()
  return NextResponse.json(readSettings())
}

export async function POST(req: NextRequest) {
  ensureDir()
  const body = (await req.json()) as MessengerSettings
  writeFileSync(SETTINGS_PATH, JSON.stringify(body, null, 2))
  return NextResponse.json({ ok: true })
}
