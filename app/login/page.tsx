'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const from = params.get('from') ?? '/'

  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      router.replace(from)
    } else {
      setError('Mot de passe incorrect')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center font-bold text-lg select-none text-white">
            M
          </div>
          <span className="text-white text-xl font-semibold">MozikAI</span>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <input
              type="password"
              placeholder="Mot de passe"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 rounded-2xl bg-[#1C1C1E] border border-[#3A3B3C] text-white placeholder-gray-600 focus:outline-none focus:border-[#0084FF] transition-colors text-[15px]"
            />
          </div>

          {error && (
            <p className="text-red-400 text-[13px] text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full py-3 rounded-2xl bg-[#0084FF] hover:bg-[#0090FF] disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-[15px] transition-colors"
          >
            {loading ? 'Connexion…' : 'Accéder'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
