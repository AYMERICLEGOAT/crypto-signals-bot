# Bot Telegram d'abonnement (USDT / Monero / Litecoin)

Bot Telegraf qui gère les abonnements au service de signaux : plans payants
en USDT (Polygon, via le smart contract), Monero ou Litecoin, essai gratuit
de 3 jours, et diffusion des signaux (table `signals` du module `signals/`)
aux abonnés actifs.

## 1. Prérequis

- Node.js 18+ (utilise le `fetch` natif — pas de dépendance HTTP supplémentaire)
- Le contrat `SignalSubscription` déployé (voir `contract/README.md`)
- Un projet Supabase avec les tables `users` / `pending_payments` créées
  (exécuter [`schema.sql`](schema.sql)) — le même projet que celui utilisé
  par le module `signals/` pour la table `signals`.
- Optionnel (Monero) : `monero-wallet-rpc` + [ngrok](https://ngrok.com) si le bot ne tourne pas sur le même PC
- Optionnel (Litecoin) : une clé API gratuite [Blockchair](https://blockchair.com/api/plans)

## 2. Installation

```bash
cd bot
npm install
cp .env.example .env
# Remplis .env (voir section 3 pour chaque variable).
```

⚠️ `.env` est ignoré par git. Ne partage jamais son contenu (token Telegram,
clé privée admin, etc.).

## 3. Configuration (.env)

| Variable | Description |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Fourni par @BotFather. |
| `SUPABASE_URL` / `SUPABASE_KEY` | Utilise la clé **service_role** (pas `anon`) : le bot doit écrire dans les tables sans être bloqué par les policies RLS publiques. |
| `CONTRACT_ADDRESS` | Adresse affichée après `npm run deploy:polygon` dans `contract/`. |
| `ADMIN_PRIVATE_KEY` | Clé privée du wallet **OWNER** (`0x71367B5f4519700a63c2564b754cF959317E1f61`), utilisée pour signer `setTrial()`. Voir avertissement section 6. |
| `MONERO_WALLET_RPC_URL` | `http://127.0.0.1:18082/json_rpc` si le bot tourne sur le même PC que `monero-wallet-rpc`, sinon l'URL ngrok. |
| `MONERO_WALLET_RPC_USER/PASSWORD` | Uniquement si `monero-wallet-rpc` est lancé avec `--rpc-login` (recommandé, surtout via ngrok — voir section 5). |
| `LTC_ACCOUNT_XPUB` | Généré une fois via `npm run generate-ltc-wallet` (voir section 5). |
| `BLOCKCHAIR_API_KEY` | Facultative mais augmente la limite de requêtes/jour. |

## 4. Lancer en développement

```bash
npm run dev
```

Utilise `tsx watch` (rechargement automatique). Pour la production :

```bash
npm run build
npm start
```

**Arrêt propre** : `Ctrl+C` (SIGINT) coupe le long polling Telegram proprement.
Le dernier bloc Polygon traité est sauvegardé dans `data/last_block.json` à
chaque événement : au redémarrage, le bot rattrape exactement ce qui a été
manqué, sans doublon ni perte.

## 5. Configurer les moyens de paiement

### USDT (Polygon)
Rien à configurer en plus de `CONTRACT_ADDRESS` : le bot écoute directement
l'événement `Subscribed` du contrat via le RPC public Polygon.

**Choix de conception important** : le bot ne demande jamais la clé privée
de l'utilisateur et ne signe rien en son nom. C'est l'utilisateur qui envoie
lui-même `approve()` puis `subscribe()` depuis son propre wallet (le bot
lui donne les instructions exactes, y compris via l'onglet *Write Contract*
de Polygonscan). Le bot se contente de détecter la confirmation on-chain.

### Monero
1. Lance `monero-wallet-rpc` avec un wallet dédié :
   ```
   monero-wallet-rpc --wallet-file mon_wallet --rpc-bind-port 18082 \
     --rpc-login admin:un_mot_de_passe_fort --daemon-address <noeud_public_ou_local>
   ```
2. Si le bot ne tourne pas sur ce même PC, expose le port via ngrok :
   ```
   ngrok http 18082
   ```
   et mets l'URL ngrok (+ `/json_rpc`) dans `MONERO_WALLET_RPC_URL`.
3. Renseigne `MONERO_WALLET_RPC_USER` / `MONERO_WALLET_RPC_PASSWORD` dans `.env`.

⚠️ **Limite technique fondamentale, pas un manque de code** : Monero est une
blockchain privée par conception. Seul un wallet possédant la clé de vue
(donc `monero-wallet-rpc`) peut vérifier qu'une sous-adresse précise a reçu
un montant précis. Un explorateur public (xmrchain.net, etc.) ne peut PAS
faire cette vérification sans cette clé — il n'existe donc pas de "fallback
public" fiable pour Monero comme il en existe un pour Litecoin. **Tant que
`monero-wallet-rpc` (et ngrok, le cas échéant) n'est pas joignable, les
paiements Monero ne peuvent pas être confirmés automatiquement** : le poller
(`src/payments/poller.ts`) logue un avertissement et réessaie simplement au
cycle suivant. Garder `monero-wallet-rpc` + ngrok actifs est donc nécessaire
pour ce moyen de paiement, contrairement à USDT et Litecoin.

### Litecoin
1. Génère un wallet HD dédié (une seule fois, si possible sur une machine hors-ligne) :
   ```bash
   npm run generate-ltc-wallet
   ```
2. Note la phrase mnémonique affichée **hors-ligne** (elle ne doit jamais être
   stockée sur le serveur du bot — elle permet de dépenser les fonds reçus).
3. Copie le `xpub` affiché dans `.env` sous `LTC_ACCOUNT_XPUB`.

Le bot ne connaît que ce xpub : il peut générer des adresses de réception et
surveiller les paiements (via l'API gratuite Blockchair), mais ne peut pas
dépenser les fonds reçus. Pour retirer les LTC reçus, importe la phrase
mnémonique dans un wallet (ex. Electrum-LTC).

## 6. Parrainage et graphiques

Chaque `/start` affiche un lien de parrainage personnel
(`https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>`, le code étant le
telegram_id encodé en base36 — pas de colonne dédiée). Quand un filleul
confirme son premier abonnement **payant**, le parrain reçoit automatiquement
7 jours gratuits (voir `src/bot/referral.ts`, `REFERRAL_BONUS_DAYS`). Exécute
[`schema_update_referral.sql`](schema_update_referral.sql) une fois avant
utilisation.

Si le module `signals/` a généré un graphique pour un signal (`chart_url`),
le dispatcher envoie une photo légendée à la place d'un simple message texte
— rien à configurer, ça fonctionne automatiquement dès que la colonne existe
(voir `signals/README.md`).

## 7. Sécurité — points à ne pas ignorer

- **`ADMIN_PRIVATE_KEY`** contrôle `setTrial()` et `withdraw()` sur le
  contrat, donc les fonds USDT collectés. Ce process doit tourner sur une
  machine que tu contrôles ; ne déploie jamais ce `.env` sur un service tiers
  non fiable. Utilise si possible un wallet dédié qui ne détient que le MATIC
  nécessaire au gas, pas de fonds importants.
- **`TELEGRAM_BOT_TOKEN`** donne un contrôle total du bot. S'il a pu fuiter
  (partagé par erreur, copié quelque part), régénère-le via @BotFather
  (`/revoke`) avant la mise en production.
- Le bot **ne demande jamais** de clé privée ni de phrase de récupération à
  l'utilisateur final — c'est une règle de conception, pas juste une
  recommandation. Si tu ajoutes des fonctionnalités, garde cette invariant.
- La mnemonic Litecoin ne doit exister que hors-ligne / sur un wallet externe,
  jamais dans `.env` ni sur le serveur du bot.

## 8. Structure des fichiers

```
bot/
  src/
    config.ts                    Chargement/validation des variables d'environnement
    index.ts                     Point d'entrée : bootstrap complet
    db/                          Accès Supabase (users, pending_payments, signals)
    blockchain/
      contract.ts                Instances ethers (lecture + wallet admin)
      subscriptionEvents.ts      Écoute + rattrapage de l'événement Subscribed
      abi/SignalSubscription.json  Générée par contract/scripts/export-abi.js
    payments/
      usdt.ts                    Instructions de paiement USDT (aucune signature côté bot)
      monero.ts                  Sous-adresses + vérification via monero-wallet-rpc
      litecoin.ts                Adresses HD watch-only + vérification via Blockchair
      httpDigestClient.ts        Authentification Digest pour monero-wallet-rpc
      priceConversion.ts         Conversion USD -> XMR/LTC via CoinGecko
      poller.ts                  Vérifie périodiquement les paiements XMR/LTC en attente
    signals/dispatcher.ts        Diffuse les signaux non envoyés aux abonnés actifs
    bot/
      commands/                  /start, /subscribe, /status, /trial
      keyboards.ts, formatting.ts, state.ts, walletAddressHandler.ts
  scripts/generate-ltc-wallet.ts À lancer une fois, hors-ligne de préférence
  schema.sql                     Tables Supabase users / pending_payments
  .env.example
```
