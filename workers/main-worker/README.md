# Worker principal — bot Telegram sur Cloudflare Workers

Portage du bot du module 2 (Node/Telegraf) vers Cloudflare Workers : webhook
Telegram + Cron Trigger toutes les 5 minutes, 100% gratuit (plan Workers
gratuit, pas de carte bancaire).

## Changements d'architecture par rapport au module 2 (Node)

Un Worker n'est pas un process persistant : pas de long polling, pas de
`setInterval`, pas de fichiers locaux, pas de `contract.on()` en écoute
continue. Adaptations nécessaires :

| Module 2 (Node) | Ici (Workers) | Pourquoi |
|---|---|---|
| Long polling Telegraf | Webhook (`POST /telegram-webhook`) | Un Worker répond à des requêtes, il ne tourne pas en boucle |
| `contract.on()` écoute continue | `catchUpMissedEvents()` dans le Cron toutes les 5 min | Pas de process persistant pour écouter |
| Map en mémoire (état conversationnel) | Table Supabase `pending_actions` | Isolat recyclable à tout moment, aucun état fiable entre requêtes |
| `data/last_block.json` | Table Supabase `chain_state` | Pas de système de fichiers persistant |
| `@supabase/supabase-js` | Client REST maison (`supabaseRest.ts`) | Reste au plus proche de "API REST + clé" comme demandé, fetch uniquement |
| `ethers.js` | JSON-RPC brut + `@noble/hashes` | **ethers.js ne charge pas sous workerd** (import statique de `node:https`, absent du runtime) — vérifié empiriquement |
| `bitcoinjs-lib`/`bip32` (Litecoin) | Pool d'adresses pré-générées (Supabase) | **Ne tournent pas non plus sous workerd** (chaîne de dépendances Node historiques incompatible, ex. `readable-stream`) — vérifié empiriquement |

Ces deux dernières lignes ne sont pas des suppositions : testées avec
`@cloudflare/vitest-pool-workers` (runtime réel `workerd`), les deux
échouent au chargement. La solution `@noble/*` + RLP manuel a été testée de
la même façon ET recoupée avec `ethers.js` en Node (transaction signée par
notre code, décodée par `ethers.Transaction.from()` avec les mêmes champs et
la même adresse récupérée depuis la signature).

## 1. Prérequis

- Un compte Cloudflare gratuit (pas de carte bancaire nécessaire pour le plan Workers gratuit)
- Node.js 18+ et `npm`
- Le contrat déjà déployé (`contract/`) et le projet Supabase avec les tables
  des modules 1 et 2 (`signals`, `users`, `pending_payments`) + celles de ce
  module (voir `schema.sql`)
- Le pool d'adresses Litecoin pré-généré une fois (voir section 4)

## 2. Installation

```bash
cd workers/main-worker
npm install
wrangler login          # ouvre le navigateur, gratuit, sans CB
```

## 3. Base de données

Exécute [`schema.sql`](schema.sql), [`schema_update_referral.sql`](schema_update_referral.sql)
dans le SQL Editor de ton projet Supabase (en plus des schémas des modules
précédents, y compris `signals/schema_update_chart.sql` pour les graphiques
— même projet).

## 4. Pool d'adresses Litecoin

Le Worker ne peut pas dériver de clés Litecoin lui-même (voir tableau
ci-dessus). Génère un lot d'adresses à l'avance avec l'outillage Node du
module 2 :

```bash
cd ../../bot
npm run generate-litecoin-pool -- 200
```

Le Worker healthcheck (`workers/healthcheck-worker`) t'alertera quand le pool
redevient bas (moins de 5 adresses par défaut) — relance cette commande à ce
moment-là.

## 5. Configurer les secrets

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET   # une chaîne aléatoire longue, générée par toi (ex: openssl rand -hex 32)
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_KEY              # clé anon ou service_role selon tes policies RLS
wrangler secret put MONERO_WALLET_RPC_URL     # optionnel, pour activer les paiements Monero
wrangler secret put MONERO_WALLET_RPC_USER    # optionnel
wrangler secret put MONERO_WALLET_RPC_PASSWORD # optionnel
wrangler secret put BLOCKCHAIR_API_KEY        # optionnel mais recommandé (limite de requêtes plus haute)
```

Édite aussi [`wrangler.toml`](wrangler.toml) (`[vars]`, non sensible) pour y
mettre l'adresse réelle du contrat déployé (`CONTRACT_ADDRESS`).

Pour tester en local avant de déployer : copie `.dev.vars.example` en
`.dev.vars` (jamais commité), remplis-le, puis `npm run dev`.

## 6. Déployer

```bash
npm run deploy
```

Note l'URL affichée (`https://signal-subscription-bot.<ton-sous-domaine>.workers.dev`).

## 7. Brancher le webhook Telegram

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WORKER_URL=https://signal-subscription-bot.<ton-sous-domaine>.workers.dev npm run set-webhook
```

`TELEGRAM_WEBHOOK_SECRET` doit être EXACTEMENT la même valeur que celle posée
via `wrangler secret put` à l'étape 5. Sans cette vérification, l'URL du
webhook serait un endpoint public non authentifié : n'importe qui la
découvrant pourrait déclencher n'importe quelle commande du bot en se faisant
passer pour Telegram — d'où le contrôle systématique de l'en-tête
`X-Telegram-Bot-Api-Secret-Token` dans `src/index.ts`.

## 8. Parrainage et graphiques dans les signaux

**Parrainage** : chaque `/start` affiche un lien personnel
(`https://t.me/<bot>?start=<code>`), où `<code>` est simplement le
telegram_id de l'utilisateur encodé en base36 (décodable directement, pas de
colonne dédiée). Quand un filleul confirme son **premier abonnement payant**
(USDT, Monero ou Litecoin — jamais un essai gratuit, pour éviter l'abus via
un second compte), le parrain reçoit automatiquement `REFERRAL_BONUS_DAYS`
(7 par défaut, voir `src/bot/referral.ts`) ajoutés à son abonnement, une
seule fois par filleul. Aucune modification du contrat n'était nécessaire :
tout est géré côté Supabase.

**Graphiques** : si le module `signals/` a généré un `chart_url` pour un
signal (voir son README, section graphiques), le Worker envoie une photo
(légendée) au lieu d'un simple message texte — rien à configurer ici, ça
fonctionne automatiquement dès que la colonne existe.

## 9. Vérifier

- `curl https://signal-subscription-bot.<...>.workers.dev/health` doit répondre `ok`
- Écris `/start` au bot sur Telegram
- Le Cron Trigger (visible dans le dashboard Cloudflare, onglet Triggers) tourne toutes les 5 minutes automatiquement

## 10. Sécurité — points à ne pas ignorer

- **`TELEGRAM_WEBHOOK_SECRET`** doit être long et aléatoire (pas un mot de
  passe mémorisable) — c'est la seule protection de l'endpoint webhook contre
  des requêtes forgées.
- Le Worker ne demande jamais de clé privée ni de phrase de récupération à
  l'utilisateur final (même principe que le module 2).
- L'essai gratuit (`/trial`) est géré 100% côté Supabase depuis la V2 (plus
  d'appel au contrat, plus de wallet admin ni de gas dépensé) — voir
  `src/bot/commands/trial.ts`.

## 11. À propos des tests locaux (`npm test`)

Ce projet utilise `@cloudflare/vitest-pool-workers`, qui exécute les tests
contre le runtime réel `workerd` (pas une simulation). **Limitation connue,
propre à cet outil sous Windows** : si le chemin du projet contient un
espace, le chargement du runtime de test échoue avec une erreur de résolution
de module — sans rapport avec le code du Worker (confirmé en testant le même
projet copié vers un chemin sans espace : tous les tests passent). Cela
n'affecte PAS `wrangler dev` ni `wrangler deploy` ni le Worker déployé,
uniquement `vitest run` en local. Si `npm test` échoue étrangement ici,
vérifie que le chemin complet du dossier ne contient pas d'espace.

## 12. Structure des fichiers

```
src/
  env.ts                        Interface des bindings (variables + secrets)
  telegram.ts                   Client API Telegram minimal (fetch uniquement)
  supabaseRest.ts                Client REST Supabase (fetch uniquement, sans SDK)
  index.ts                       fetch() (webhook + /health) et scheduled() (cron)
  db/                             users, payments, signals, pending_actions, chain_state, litecoin pool
  blockchain/
    rpc.ts                        JSON-RPC brut (remplace ethers.js)
    abi.ts                        Encodage/décodage ABI "à la main"
    usdtTransfers.ts               Flux de paiement actif (V2, 100% off-chain, événements Transfer USDT)
    subscriptionEvents.ts          Rattrapage des événements Subscribed du contrat -- dormant,
                                    activable via ONCHAIN_CONTRACT_POLLING_ENABLED (voir env.ts)
  payments/                       usdt.ts, monero.ts, litecoin.ts, priceConversion.ts, httpDigestClient.ts
  bot/                             commandes, clavier, routeur d'updates, formatage
  cron/                            dispatchSignals.ts, pollPayments.ts
scripts/set-webhook.ts             À lancer une fois après déploiement
schema.sql                         Tables additionnelles (pending_actions, chain_state, litecoin pool)
```
