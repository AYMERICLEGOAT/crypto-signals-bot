# Worker healthcheck

Second Worker, indépendant du Worker principal, qui vérifie toutes les
heures (Cron Trigger) :

1. que le Worker principal répond (`GET /health`) ;
2. que Supabase est accessible (appel REST direct, indépendant du check n°1) ;
3. que le pool d'adresses Litecoin pré-générées n'est pas presque épuisé.

En cas d'anomalie sur l'un des trois points, il envoie un message privé à
l'administrateur via l'API Telegram (`sendMessage` à `ADMIN_CHAT_ID`).

## 1. Installation

```bash
cd workers/healthcheck-worker
npm install
```

## 2. Configuration

Édite [`wrangler.toml`](wrangler.toml) (`MAIN_WORKER_HEALTH_URL`, non
sensible) avec l'URL réelle du Worker principal une fois déployé.

Secrets :

```bash
wrangler secret put TELEGRAM_BOT_TOKEN   # peut être le même bot que le Worker principal, ou un second bot dédié à la supervision
wrangler secret put ADMIN_CHAT_ID        # ton chat_id Telegram personnel (voir ci-dessous comment l'obtenir)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_KEY
```

**Obtenir ton `chat_id`** : écris n'importe quel message à ton bot sur
Telegram, puis va sur
`https://api.telegram.org/bot<TON_TOKEN>/getUpdates` dans un navigateur —
le champ `message.chat.id` de la réponse JSON est ton chat_id.

Pour tester en local : copie `.dev.vars.example` en `.dev.vars`, remplis-le, `npm run dev`.

## 3. Déployer

```bash
npm run deploy
```

## 4. Vérifier manuellement

`GET https://signal-subscription-healthcheck.<ton-sous-domaine>.workers.dev/`
déclenche immédiatement les trois vérifications et retourne le détail en
JSON (status 200 si tout va bien, 503 sinon) — pratique pour tester sans
attendre la prochaine heure pile.
