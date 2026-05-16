import { NextRequest, NextResponse } from 'next/server'
import { addPayment } from '@/lib/store'

const MERCHANT_NUMBER = '0341486900'

/**
 * Reject messages that look like outgoing payments/transfers.
 * Accept only incoming money notifications.
 */
function isIncomingTransaction(messageText: string): boolean {
  const lower = messageText.toLowerCase()

  // Outgoing indicators — if any matches, it's NOT an incoming transaction
  const outgoingPatterns = [
    /\benvoy[ée]\b/,
    /\benvoye\b/,
    /\bpay[ée]\b/,
    /\bpaye\b/,
    /\bpaid\b/,
    /\bsent\b/,
    /\bpaiement\s+effectu[ée]\b/,
    /\btransfert\s+effectu[ée]\b/,
    /\bvirement\s+envoy[ée]\b/,
    /\bvous\s+avez\s+envoy/,
  ]
  for (const p of outgoingPatterns) {
    if (p.test(lower)) return false
  }

  // Incoming indicators — at least one must match
  const incomingPatterns = [
    /\bre[çc]u\b/,
    /\breceived\b/,
    /\bde\s+la\s+part\s+de\b/,
    /\btransfert\s+international\b/,
    /\bre[çc]u\s+de\b/,
  ]
  for (const p of incomingPatterns) {
    if (p.test(lower)) return true
  }

  return false
}

function extractSenderPhone(messageText: string, phonenumber: string): string {
  const text = String(messageText)
  const searchSpace = text.replace(/\s/g, '')

  // 1. Find all Malagasy phone numbers: +2613... or 03...
  const mgMatches = searchSpace.match(/(?:\+261|0)(3[2-49]\d{7})/g)
  if (mgMatches) {
    const candidates = mgMatches
      .map(p => p.replace(/^\+261/, '0'))
      .filter(p => p !== MERCHANT_NUMBER)
    if (candidates.length > 0) return candidates[0]
  }

  // 2. Fallback: spaced Malagasy number after sender keywords
  const spacedMatch = text.match(
    /(?:de\s+la\s+part\s+de|from|depuis|expediteur).*?(0\s*3\s*[2-49](?:\s*\d){7})/i
  )
  if (spacedMatch) {
    const cleaned = spacedMatch[1].replace(/\s/g, '')
    if (cleaned !== MERCHANT_NUMBER) return cleaned
  }

  // 3. International numbers after sender keywords (e.g. +33613083079)
  const intlContextMatch = text.match(
    /(?:de\s+la\s+part\s+de|from|depuis|expediteur|transfert\s+international\s+de)\s*(\+\d[\d\s]{6,14})/i
  )
  if (intlContextMatch) {
    const cleaned = intlContextMatch[1].replace(/\s/g, '')
    if (cleaned !== '+' + MERCHANT_NUMBER && cleaned !== MERCHANT_NUMBER) return cleaned
  }

  // 4. Any international number in the message
  const anyIntl = searchSpace.match(/\+\d{8,15}/g)
  if (anyIntl) {
    const candidates = anyIntl.filter(
      p => p !== '+' + MERCHANT_NUMBER && p !== MERCHANT_NUMBER
    )
    if (candidates.length > 0) return candidates[0]
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

    // Only process incoming transactions
    if (!isIncomingTransaction(message)) {
      console.log('[payment/webhook] ignored outgoing/non-transaction message:', message)
      return NextResponse.json({ ok: true, ignored: true, reason: 'not incoming transaction' })
    }

    // Extract amount — matches "35500 Ar", "2 500 Ar", "2500Ar"
    const amountMatch = String(message).match(/(\d[\d\s]*)\s*Ar/i)
    const amount = amountMatch ? parseInt(amountMatch[1].replace(/\s/g, ''), 10) : 0

    // Extract Ref / Trans Id — matches "Ref : 123564564" or "Trans Id: MP251020.1417.B29719"
    const transMatch = String(message).match(/(?:Ref|Trans\s*Id)\s*:\s*([A-Za-z0-9.\-_]+)/i)
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
