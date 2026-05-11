import { NextRequest, NextResponse } from 'next/server'
import { addPayment } from '@/lib/store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, phonenumber } = body

    if (!message || !phonenumber) {
      return NextResponse.json({ error: 'Missing message or phonenumber' }, { status: 400 })
    }

    // Extract amount — matches "35500 Ar", "2 500 Ar", "2500Ar"
    const amountMatch = String(message).match(/(\d[\d\s]*)\s*Ar/i)
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/\s/g, ''), 10) : 0

    // Extract Trans Id — matches "Trans Id: MP251020.1417.B29719"
    const transMatch = String(message).match(/Trans\s*Id:\s*([A-Z0-9.]+)/i)
    const transId = transMatch ? transMatch[1] : 'unknown'

    const record = await addPayment(amount, phonenumber, transId, message)
    console.log('[payment/webhook] recorded:', record)

    return NextResponse.json({ ok: true, record })
  } catch (err) {
    console.error('[payment/webhook]', err)
    const msg = err instanceof Error ? err.message : 'Invalid payload'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
