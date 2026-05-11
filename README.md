# MozikAI — Lyria 3 Pro Playground

Générateur de musique IA propulsé par **Google Lyria 3 Pro** via OpenRouter.  
Interface chatbot pour composer des morceaux complets avec paroles.

---

## Fonctionnalités

- Composition guidée (genre, époque, tempo, instruments, voix, paroles)
- Génération audio + paroles via `google/lyria-3-pro-preview`
- Lecteur intégré avec waveform et téléchargement MP3
- Historique des créations
- Webhook Facebook Messenger
- Déploiement Docker / Railway prêt

---

## Stack

- Next.js 15 (App Router)
- React 19 + Tailwind CSS
- PostgreSQL (production) / Filesystem (développement)
- OpenRouter → Google Lyria 3 Pro

---

## Démarrage local

### Prérequis

- Node.js 18+
- (Optionnel) Docker Desktop pour PostgreSQL local

### Installation

```bash
git clone https://github.com/itsaina/MozikAI.git
cd MozikAI
npm install
```

### Configuration

Créer `.env.local` à la racine :

```env
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
```

> Récupérer une clé sur [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)

Sans `DATABASE_URL`, l'application utilise automatiquement le stockage fichier local.

### Lancer le serveur

```bash
npm run dev
```

L'application est accessible sur [http://localhost:3000](http://localhost:3000)

---

## Docker (local avec PostgreSQL)

```bash
docker compose up -d db
npm run dev
```

---

## Déploiement Railway

### 1. Pousser sur GitHub

```bash
git add .
git commit -m "Ready for Railway"
git push origin main
```

### 2. Configurer Railway

1. Aller sur [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Sélectionner le repo
3. **New** → **Database** → **Add PostgreSQL**  
   Railway injecte automatiquement `DATABASE_URL`
4. Dans l'onglet **Variables**, ajouter :
   ```
   OPENROUTER_API_KEY = sk-or-v1-xxxxxxxx
   ```
5. Déploiement automatique via `Dockerfile` + `railway.toml`

---

## Intégration Facebook Messenger (optionnel)

1. Aller sur `/messenger` de l'application déployée
2. Renseigner :
   - Page Access Token
   - Verify Token
   - App Secret
3. Configurer le webhook dans Meta for Developers :
   - URL : `https://<app>.up.railway.app/api/messenger/webhook`
   - Verify Token : celui défini à l'étape 2

---

## Structure

```
app/
  api/
    audio/[id]/      # Endpoint MP3
    generate/        # Appel OpenRouter
    history/         # CRUD historique
    messenger/       # Webhook & settings
  page.tsx           # Interface chatbot
lib/
  store.ts           # Stockage PG / filesystem
Dockerfile
railway.toml
docker-compose.yml
```

---

## Coûts

| Service | Prix |
|---------|------|
| Railway (gratuit) | 500h + 1GB |
| OpenRouter Lyria 3 Pro | ~$0.08 / chanson (crédits gratuits à l'inscription) |
