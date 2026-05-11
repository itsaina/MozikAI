'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Settings {
  pageAccessToken: string
  verifyToken: string
  appSecret: string
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function TokenInput({
  label, value, onChange, placeholder, help,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  help?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="space-y-1.5">
      <label className="block text-[13px] font-medium text-gray-300">{label}</label>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-[#2A2A2A] border border-[#3A3B3C] rounded-xl px-4 py-2.5 pr-10 text-[14px] text-white placeholder-gray-600 focus:outline-none focus:border-[#0084FF] transition-colors font-mono"
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <EyeIcon open={visible} />
        </button>
      </div>
      {help && <p className="text-[12px] text-gray-600 leading-relaxed">{help}</p>}
    </div>
  )
}

const GUIDE_STEPS = [
  {
    num: '1',
    title: 'Créer une app Meta',
    body: 'Va sur developers.facebook.com → "Mes apps" → "Créer une app". Choisis le type "Business" ou "None".',
  },
  {
    num: '2',
    title: 'Ajouter le produit Messenger',
    body: 'Dans le tableau de bord de l\'app, clique "+ Ajouter un produit" → Messenger → Configure.',
  },
  {
    num: '3',
    title: 'Générer le Page Access Token',
    body: 'Dans Messenger → Paramètres → "Jetons d\'accès" → sélectionne ta Page Facebook → copie le jeton. Colle-le dans le champ "Page Access Token" ci-dessus.',
  },
  {
    num: '4',
    title: 'Configurer le Webhook',
    body: 'Dans Messenger → Paramètres → Webhooks → "Ajouter un callback URL". Colle l\'URL de webhook affichée ci-dessus et ton Token de vérification. Abonne-toi à : messages, messaging_postbacks.',
  },
  {
    num: '5',
    title: 'Rendre le webhook public (dev local)',
    body: 'Facebook requiert une URL HTTPS publique. En développement local, utilise ngrok : npx ngrok http 3000. L\'URL ngrok devient ton domaine dans le champ webhook.',
  },
  {
    num: '6',
    title: 'App Secret (recommandé)',
    body: 'Dans Paramètres → Informations de base → "Secret de l\'app". Permet de vérifier l\'authenticité des messages entrants.',
  },
]

export default function MessengerPage() {
  const [settings, setSettings] = useState<Settings>({ pageAccessToken: '', verifyToken: '', appSecret: '' })
  const [webhookUrl, setWebhookUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [copiedWebhook, setCopiedWebhook] = useState(false)
  const [copiedVerify, setCopiedVerify] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    setWebhookUrl(`${window.location.origin}/api/messenger/webhook`)
    fetch('/api/messenger/settings')
      .then(r => r.json())
      .then((data: Settings) => setSettings(data))
      .catch(() => {})
  }, [])

  const generateVerifyToken = () => {
    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 32)
    setSettings(s => ({ ...s, verifyToken: token }))
  }

  const save = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/messenger/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${settings.pageAccessToken}`)
      const data = await res.json() as { name?: string; error?: { message?: string } }
      if (res.ok && data.name) {
        setTestResult({ ok: true, msg: `Connecté à la page : ${data.name}` })
      } else {
        setTestResult({ ok: false, msg: data.error?.message ?? 'Token invalide' })
      }
    } catch {
      setTestResult({ ok: false, msg: 'Erreur réseau' })
    } finally {
      setTesting(false)
    }
  }

  const copyToClipboard = useCallback((text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  const isConfigured = settings.pageAccessToken.length > 0 && settings.verifyToken.length > 0

  return (
    <div className="min-h-screen bg-black text-white">

      {/* Header */}
      <header className="bg-[#1C1C1E] border-b border-[#3A3B3C] sticky top-0 z-10">
        <div className="max-w-[680px] mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/"
            className="w-9 h-9 rounded-full bg-[#3A3B3C] flex items-center justify-center text-gray-400 hover:text-white hover:bg-[#4A4B4C] transition-colors flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex-1">
            <p className="font-semibold text-[15px] leading-tight">Intégration Messenger</p>
            <p className="text-[12px] text-gray-500 leading-tight">Facebook Messenger Bot</p>
          </div>
          {/* Status pill */}
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium ${
            isConfigured
              ? 'bg-green-500/15 text-green-400 border border-green-500/30'
              : 'bg-gray-500/15 text-gray-500 border border-gray-500/30'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${isConfigured ? 'bg-green-400' : 'bg-gray-500'}`} />
            {isConfigured ? 'Configuré' : 'Non configuré'}
          </div>
        </div>
      </header>

      <div className="max-w-[680px] mx-auto px-4 py-6 space-y-5">

        {/* ── Tokens ── */}
        <section className="bg-[#1C1C1E] border border-[#3A3B3C] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#3A3B3C]">
            <h2 className="font-semibold text-[15px]">Tokens Facebook</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">Requis pour envoyer et recevoir des messages.</p>
          </div>
          <div className="px-5 py-5 space-y-5">
            <TokenInput
              label="Page Access Token *"
              value={settings.pageAccessToken}
              onChange={v => setSettings(s => ({ ...s, pageAccessToken: v }))}
              placeholder="EAAxxxxxxxxxxxxxxx..."
              help="Généré depuis Meta Developer → Messenger → Paramètres → Jetons d'accès."
            />
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-gray-300">Token de vérification *</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={settings.verifyToken}
                  onChange={e => setSettings(s => ({ ...s, verifyToken: e.target.value }))}
                  placeholder="mon_token_secret_123"
                  className="flex-1 bg-[#2A2A2A] border border-[#3A3B3C] rounded-xl px-4 py-2.5 text-[14px] text-white placeholder-gray-600 focus:outline-none focus:border-[#0084FF] transition-colors font-mono"
                />
                <button
                  onClick={generateVerifyToken}
                  className="px-4 py-2.5 rounded-xl bg-[#3A3B3C] text-[13px] text-gray-300 hover:bg-[#4A4B4C] transition-colors whitespace-nowrap flex-shrink-0"
                >
                  Générer
                </button>
              </div>
              <p className="text-[12px] text-gray-600">Chaîne aléatoire que tu définis toi-même. Doit correspondre à ce que tu saisiras dans Meta.</p>
            </div>
            <TokenInput
              label="App Secret (recommandé)"
              value={settings.appSecret}
              onChange={v => setSettings(s => ({ ...s, appSecret: v }))}
              placeholder="abc123def456..."
              help="Paramètres → Informations de base → Secret de l'app. Permet de valider la signature des webhooks."
            />
          </div>
        </section>

        {/* ── Webhook URL ── */}
        <section className="bg-[#1C1C1E] border border-[#3A3B3C] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#3A3B3C]">
            <h2 className="font-semibold text-[15px]">URL du Webhook</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">À coller dans la configuration Meta Developer.</p>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-gray-300">Callback URL</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-[#2A2A2A] border border-[#3A3B3C] rounded-xl px-4 py-2.5 text-[14px] text-gray-400 font-mono overflow-x-auto whitespace-nowrap">
                  {webhookUrl}
                </div>
                <button
                  onClick={() => copyToClipboard(webhookUrl, setCopiedWebhook)}
                  className="px-3 py-2.5 rounded-xl bg-[#3A3B3C] hover:bg-[#4A4B4C] transition-colors flex items-center gap-1.5 text-gray-300 flex-shrink-0"
                >
                  {copiedWebhook ? <CheckIcon /> : <CopyIcon />}
                  <span className="text-[13px]">{copiedWebhook ? 'Copié' : 'Copier'}</span>
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="block text-[13px] font-medium text-gray-300">Token de vérification</label>
              <div className="flex gap-2">
                <div className="flex-1 bg-[#2A2A2A] border border-[#3A3B3C] rounded-xl px-4 py-2.5 text-[14px] text-gray-400 font-mono">
                  {settings.verifyToken || <span className="text-gray-600 italic">Non défini</span>}
                </div>
                {settings.verifyToken && (
                  <button
                    onClick={() => copyToClipboard(settings.verifyToken, setCopiedVerify)}
                    className="px-3 py-2.5 rounded-xl bg-[#3A3B3C] hover:bg-[#4A4B4C] transition-colors flex items-center gap-1.5 text-gray-300 flex-shrink-0"
                  >
                    {copiedVerify ? <CheckIcon /> : <CopyIcon />}
                    <span className="text-[13px]">{copiedVerify ? 'Copié' : 'Copier'}</span>
                  </button>
                )}
              </div>
            </div>
            <div className="bg-[#0084FF]/8 border border-[#0084FF]/20 rounded-xl px-4 py-3 space-y-1">
              <p className="text-[13px] font-medium text-[#0084FF]">Abonnements webhook requis</p>
              <p className="text-[12px] text-gray-400">
                <code className="text-gray-300">messages</code> · <code className="text-gray-300">messaging_postbacks</code>
              </p>
            </div>
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-4 py-3">
              <p className="text-[13px] font-medium text-amber-400">URL HTTPS requise</p>
              <p className="text-[12px] text-gray-400 mt-0.5">
                En développement local, utilise <code className="text-gray-300">ngrok</code> :
              </p>
              <code className="text-[12px] text-amber-300/80 mt-1 block">npx ngrok http 3000</code>
              <p className="text-[12px] text-gray-500 mt-1">L'URL ngrok remplace <code>localhost:3000</code> dans le webhook.</p>
            </div>
          </div>
        </section>

        {/* ── Test de connexion ── */}
        {settings.pageAccessToken && (
          <section className="bg-[#1C1C1E] border border-[#3A3B3C] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#3A3B3C]">
              <h2 className="font-semibold text-[15px]">Test de connexion</h2>
              <p className="text-[12px] text-gray-500 mt-0.5">Vérifie que le Page Access Token est valide.</p>
            </div>
            <div className="px-5 py-5 space-y-3">
              <button
                onClick={testConnection}
                disabled={testing}
                className="px-5 py-2.5 rounded-xl bg-[#0084FF]/15 border border-[#0084FF]/30 text-[#0084FF] text-[14px] font-medium hover:bg-[#0084FF]/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {testing && (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                {testing ? 'Test en cours...' : 'Tester la connexion'}
              </button>
              {testResult && (
                <div className={`px-4 py-3 rounded-xl text-[13px] ${
                  testResult.ok
                    ? 'bg-green-500/10 border border-green-500/30 text-green-400'
                    : 'bg-red-500/10 border border-red-500/30 text-red-400'
                }`}>
                  {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Guide d'installation ── */}
        <section className="bg-[#1C1C1E] border border-[#3A3B3C] rounded-2xl overflow-hidden">
          <button
            onClick={() => setGuideOpen(o => !o)}
            className="w-full px-5 py-4 flex items-center justify-between text-left"
          >
            <div>
              <h2 className="font-semibold text-[15px]">Guide d'installation</h2>
              <p className="text-[12px] text-gray-500 mt-0.5">Configuration étape par étape.</p>
            </div>
            <svg
              className={`w-5 h-5 text-gray-500 transition-transform ${guideOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {guideOpen && (
            <div className="border-t border-[#3A3B3C] px-5 py-5 space-y-4">
              {GUIDE_STEPS.map(step => (
                <div key={step.num} className="flex gap-4">
                  <div className="w-6 h-6 rounded-full bg-[#0084FF]/20 border border-[#0084FF]/40 flex items-center justify-center text-[11px] font-bold text-[#0084FF] flex-shrink-0 mt-0.5">
                    {step.num}
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-white mb-1">{step.title}</p>
                    <p className="text-[12px] text-gray-500 leading-relaxed">{step.body}</p>
                  </div>
                </div>
              ))}
              <div className="mt-2 pt-4 border-t border-[#3A3B3C]">
                <p className="text-[12px] text-gray-600 leading-relaxed">
                  Une fois configuré, envoie un message à ta page Facebook et MozikAI répondra avec les questions step-by-step en français, avec les quick replies Messenger.
                </p>
              </div>
            </div>
          )}
        </section>

        {/* ── Flow du bot ── */}
        <section className="bg-[#1C1C1E] border border-[#3A3B3C] rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-[#3A3B3C]">
            <h2 className="font-semibold text-[15px]">Fonctionnement du bot</h2>
          </div>
          <div className="px-5 py-5 space-y-3">
            {[
              { icon: '💬', label: "L'utilisateur envoie n'importe quel message", sub: "Ex : 'bonjour', 'salut', 'start'" },
              { icon: '🎵', label: '7 questions avec quick replies', sub: 'Genre, époque, tempo, son, énergie, voix, paroles' },
              { icon: '✅', label: 'Récap du prompt + confirmation', sub: "L'utilisateur envoie 'générer'" },
              { icon: '🎶', label: 'Génération via Lyria 3 Pro', sub: 'Audio + paroles envoyés dans Messenger' },
              { icon: '🔄', label: "Envoie 'recommencer' à tout moment", sub: 'Repart du début' },
            ].map(item => (
              <div key={item.label} className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">{item.icon}</span>
                <div>
                  <p className="text-[13px] font-medium text-white">{item.label}</p>
                  <p className="text-[12px] text-gray-500">{item.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Bouton Sauvegarder ── */}
        <div className="pb-8">
          <button
            onClick={save}
            disabled={saving}
            className="w-full py-4 rounded-2xl text-[15px] font-semibold bg-[#0084FF] hover:bg-[#0090FF] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-white flex items-center justify-center gap-2.5"
          >
            {saving ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Sauvegarde...
              </>
            ) : saved ? (
              <>
                <CheckIcon />
                Sauvegardé !
              </>
            ) : 'Sauvegarder la configuration'}
          </button>
        </div>
      </div>
    </div>
  )
}
