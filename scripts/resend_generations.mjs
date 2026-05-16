import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  connectionString: 'postgresql://postgres:hTUToTShQFSgnGfrZEPTioPmvagHsMks@viaduct.proxy.rlwy.net:26284/railway',
  ssl: { rejectUnauthorized: false },
})

const { rows } = await pool.query("SELECT value FROM messenger_settings WHERE key = 'pageAccessToken'")
const FB_TOKEN = rows[0].value
await pool.end()

const BASE_URL = 'https://mozikai-production.up.railway.app'

const GENERATIONS = [
  { id: '1778914220745', senderId: '26554453507569972' },
  { id: '1778912078896', senderId: '35672109622404517' },
]

async function sendMsg(senderId, body) {
  const res = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${FB_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: senderId }, messaging_type: 'RESPONSE', message: body }),
  })
  const d = await res.json()
  if (!res.ok) console.error('sendMsg error:', JSON.stringify(d))
  else console.log('OK:', senderId, '->', JSON.stringify(body).slice(0, 80))
  return d
}

for (const { id, senderId } of GENERATIONS) {
  const audioUrl = `${BASE_URL}/api/audio/${id}`
  console.log(`\n→ Sending to ${senderId} (gen ${id})`)

  await sendMsg(senderId, {
    attachment: { type: 'audio', payload: { url: audioUrl, is_reusable: true } },
  })

  await sendMsg(senderId, {
    attachment: { type: 'file', payload: { url: audioUrl, is_reusable: true } },
  })

  await sendMsg(senderId, {
    text: "✅ Vita! Raha tianao hanao hira vaovao, atereo ny 'recommencer'.",
  })
}

console.log('\n✅ Done.')
