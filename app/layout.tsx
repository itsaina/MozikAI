import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MozikAI — Lyria 3 Pro Playground',
  description: 'Generate music with Google Lyria 3 Pro via OpenRouter',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#080810] text-white min-h-screen antialiased">{children}</body>
    </html>
  )
}
