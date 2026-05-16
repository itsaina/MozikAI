import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MozikAI',
  description: 'Hamorona hira amin\'ny AI',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#080810] text-white min-h-screen antialiased">{children}</body>
    </html>
  )
}
