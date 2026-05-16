import { Pool } from 'pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messenger_messages (
      id            SERIAL PRIMARY KEY,
      facebook_id   TEXT        NOT NULL,
      message_text  TEXT,
      quick_reply   TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

export async function logMessage(facebookId: string, messageText: string, quickReply: string | null) {
  await pool.query(
    'INSERT INTO messenger_messages (facebook_id, message_text, quick_reply) VALUES ($1, $2, $3)',
    [facebookId, messageText || null, quickReply || null]
  )
}
