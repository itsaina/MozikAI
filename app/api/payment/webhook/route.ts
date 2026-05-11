import { NextRequest, NextResponse } from 'next/server'
import { addPayment } from '@/lib/store'

const MERCHANT_NUMBER = '0341486900'

function extractSenderPhone(messageText: string, phonenumber: string): string {
  // Search in both message and id fields (some apps put SMS text in id)
  const searchSpace = String(messageText).replace(/\s/g, '')

  // Find all Malagasy phone numbers: +2613... or 03...
  const matches = searchSpace.match(/(?:\+261|0)(3[2-49]\d{7})/g)

  if (matches) {
    // Normalize +261 -> 0 and filter out merchant number
    const candidates = matches
      .map(p => p.replace(/^\+261/, '0'))
      .filter(p => p !== MERCHANT_NUMBER)

    if (candidates.length > 0) {
      return candidates[0]
    }
  }

  // Fallback: if the message mentions a number with spaces like "034 12 345 67"
  const spacedMatch = String(messageText).match(/(?:de\s+la\s+part\s+de|from|depuis|expediteur).*?(0\s*3\s*[2-49](?:\s*\d){7})/i)
  if (spacedMatch) {
    const cleaned = spacedMatch[1].replace(/\s/g, '')
    if (cleaned !== MERCHANT_NUMBER) return cleaned
  }

  // Last resort: use phonenumber from JSON (but this is usually the merchant number)
  return phonenumber.replace(/^\+261/, '0')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { message, phonenumber, id } = body

    if (!message || !phonenumber) {
      return NextResponse.json({ error: 'Missing message or phonenumber' }, { status: 400 })
    }

    // Extract amount — matches "35500 Ar", "2 500 Ar", "2500Ar"
    const amountMatch = String(message).match(/(\d[\d\s]*)\s*Ar/i)
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/\s/g, ''), 10) : 0

    // Extract Ref / Trans Id — matches "Ref : 123564564" or "Trans Id: MP251020.1417.B29719"
    const transMatch = String(message).match(/(?:Ref|Trans\s*Id)\s*:\s*([A-Z0-9.]+)/i)
    const transId = transMatch ? transMatch[1] : 'unknown'

    // Extract customer phone from message text, NOT from phonenumber field
    const senderPhone = extractSenderPhone(id ?? message, phonenumber)

    const record = await addPayment(amount, senderPhone, transId, message)
    console.log('[payment/webhook] recorded:', record)

    return NextResponse.json({ ok: true, record })
  } catch (err) {
    console.error('[payment/webhook]', err)
    const msg = err instanceof Error ? err.message : 'Invalid payload'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
