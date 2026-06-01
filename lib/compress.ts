import ffmpeg from 'fluent-ffmpeg'
import { PassThrough, Readable } from 'stream'

// Use system ffmpeg (installed via apk in the Dockerfile).
// @ffmpeg-installer was unreliable on Alpine — the linux-x64 optional dep
// was missing from /app/node_modules and broke every build since May 21.
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH)
}

// Re-encode MP3 at 96kbps — reduces ~10MB files to ~2-3MB without audible quality loss.
// Returns base64 string (no data: prefix).
export async function compressAudioBase64(base64: string, bitrate = '96k'): Promise<string> {
  const raw = base64.startsWith('data:') ? base64.split(',')[1] : base64
  const inputBuffer = Buffer.from(raw, 'base64')

  return new Promise((resolve, reject) => {
    const inputStream = Readable.from(inputBuffer)
    const outputStream = new PassThrough()
    const chunks: Buffer[] = []

    outputStream.on('data', (chunk: Buffer) => chunks.push(chunk))
    outputStream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')))
    outputStream.on('error', reject)

    ffmpeg(inputStream)
      .inputFormat('mp3')
      .audioCodec('libmp3lame')
      .audioBitrate(bitrate)
      .format('mp3')
      .on('error', reject)
      .pipe(outputStream)
  })
}
