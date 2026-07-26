# Signaux Crypto Gratuits

Service de signaux de trading crypto (analyse technique automatisée :
croisement EMA9/21 + RSI, sur 20 paires USDT) diffusés via un bot Telegram
(**@ProVIPSignals_bot**), avec un canal public gratuit et des abonnements
payants (Standard/Pro/Découverte) réglés en cryptoactifs (USDT, Monero,
Litecoin) — **sans jamais détenir les fonds des utilisateurs**.

Conçu pour tourner **100% automatiquement, gratuitement (infra) et
anonymement** : aucun serveur à payer ni administrer en continu (tout
tourne sur des plans gratuits — GitHub Actions, Cloudflare Workers,
Supabase), aucune donnée d'identité collectée (identifiant Telegram +
adresse wallet publique, rien d'autre — voir [`public/privacy.html`](public/privacy.html)).

## Architecture — 6 modules indépendants

```
                     ┌─────────────────┐
                     │  Supabase (DB)  │  ← état partagé entre tous les modules
                     └────────┬────────┘
                              │
   ┌──────────┐   signaux    │    ┌──────────────┐   webhook Telegram
   │ signals/ │──────────────┼───▶│   workers/   │◀──────────────────  utilisateurs
   │ (Python) │  (Supabase)  │    │ main-worker  │
   └──────────┘              │    │ (Cloudflare) │
   GitHub Actions, horaire   │    └──────┬───────┘
                              │           │ cron 5 min : diffusion,
   ┌──────────┐   lit les    │           │ paiements, relances, RGPD…
   │ website/ │◀─────────────┤           │
   │ (Python) │  signaux +   │    ┌──────▼───────────┐
   └──────────┘  backtest    │    │ healthcheck-      │
   Site SEO (FR/EN), publié  │    │ worker (Cloudflare)│  supervision horaire
   sur GitHub → Cloudflare   │    └────────────────────┘
                              │
   ┌──────────┐   lit le     │
   │ traffic/ │◀─────────────┘
   │ (Python) │  dernier signal
   └──────────┘
   Twitter/Reddit/Discord, quotidien (GitHub Actions)

   ┌──────────┐
   │ contract/│  Smart contract Solidity — dormant (voir section dédiée)
   └──────────┘
```

| Module | Rôle | Exécution | Détails |
|---|---|---|---|
| [`signals/`](signals/README.md) | Génère les signaux ACHAT/VENTE (Binance, repli CoinGecko) + backtest 24 mois | GitHub Actions, toutes les heures | [README](signals/README.md) |
| [`workers/main-worker/`](workers/main-worker/README.md) | Bot Telegram (webhook + commandes), diffusion des signaux, paiements USDT/XMR/LTC 100% off-chain, abonnements, parrainage, relances | Cloudflare Workers, cron toutes les 5 min | [README](workers/main-worker/README.md) |
| [`workers/healthcheck-worker/`](workers/healthcheck-worker/README.md) | Supervise le Worker principal + Supabase + pool d'adresses LTC, alerte Telegram si anomalie | Cloudflare Workers, cron horaire | [README](workers/healthcheck-worker/README.md) |
| [`website/`](website/README.md) | Génère le site SEO (FR/EN) : signaux du jour, performance réelle suivie, archives du backtest, CGV/privacy | GitHub Actions, après chaque run de `signals/` + filet quotidien | [README](website/README.md) |
| [`traffic/`](traffic/README.md) | Publie le dernier signal sur Twitter, Reddit, Discord (comptes réels, API officielles) | GitHub Actions, quotidien | [README](traffic/README.md) |
| [`contract/`](contract/README.md) | Smart contract Solidity de abonnement on-chain — **dormant**, non utilisé par le flux de paiement actif (voir ci-dessous) | Déployé sur Amoy (testnet) uniquement | [README](contract/README.md) |

Il existait un 7ᵉ module (`bot/`, un bot Node.js/Telegraf antérieur au
portage Cloudflare Workers) — **supprimé** : entièrement remplacé par
`workers/main-worker/`, il ne tournait plus nulle part et exposait des
secrets de production dans un fichier `.env` local resté sur le dépôt.

### Pourquoi le smart contract est dormant

Le paiement USDT est **100% off-chain (V2)** : le Worker principal
surveille directement les transferts USDT entrants vers une adresse de
réception fixe (`payments/usdt.ts` + `cron/pollPayments.ts`), sans jamais
passer par un contrat — plus simple, sans frais de déploiement mainnet, et
sans risque lié à un contrat immuable en production. Le contrat Solidity de
`contract/` reste dans le dépôt pour une éventuelle réactivation future,
mais son adresse déployée (`CONTRACT_ADDRESS` dans `wrangler.toml`) est sur
le testnet Amoy — le polling on-chain correspondant est désactivé
explicitement (`ONCHAIN_CONTRACT_POLLING_ENABLED = "false"`, voir
`workers/main-worker/src/env.ts`).

## Mise en route

Chaque module a son propre README avec les instructions détaillées
(prérequis, variables d'environnement, déploiement). Ordre recommandé pour
un déploiement complet :

1. Exécuter [`init.sql`](init.sql) une fois dans le SQL Editor Supabase — schéma complet, idempotent.
2. [`workers/main-worker/`](workers/main-worker/README.md) — le bot lui-même (Cloudflare Workers).
3. [`workers/healthcheck-worker/`](workers/healthcheck-worker/README.md) — supervision (optionnel mais recommandé).
4. [`signals/`](signals/README.md) — génération des signaux (GitHub Actions).
5. [`website/`](website/README.md) — site SEO (GitHub Actions + Cloudflare Pages/Workers).
6. [`traffic/`](traffic/README.md) — promotion sur les réseaux sociaux (GitHub Actions, optionnel).

✅ **Bloc 15.3 — Sauvegardes Supabase** : le plan gratuit Supabase ne propose
AUCUN backup automatique (ni quotidien, ni PITR — réservés aux plans payants,
vérifié directement dans le dashboard). La sauvegarde réelle est donc
[`signals/backup_db.py`](signals/backup_db.py), exécuté chaque lundi 3h UTC
par [`.github/workflows/backup.yml`](.github/workflows/backup.yml) : il
exporte toutes les tables en JSON, en séparant strictement les données sans
information personnelle (commitées dans `signals/backups/public/`, visibles
dans ce dépôt public) des tables contenant des identifiants Telegram ou des
adresses de paiement (`users`, `pending_payments`, etc. — jamais commitées,
seulement conservées 90 jours en artefact GitHub Actions privé). Rien à
activer côté Supabase.

## Principes du projet

- **Gratuit à opérer** : tous les services utilisés (GitHub Actions, Cloudflare Workers, Supabase) ont un plan gratuit suffisant pour ce volume — le seul coût réel pour l'opérateur du bot est le gas Polygon des actions ponctuelles côté admin.
- **Anonyme** : ni le bot ni le site ne demandent nom, email ou numéro de téléphone. Voir [`public/privacy.html`](public/privacy.html).
- **Automatique** : aucun processus ne nécessite une machine ou un humain en continu (cron GitHub Actions + Cloudflare Cron Triggers uniquement) — exception assumée et documentée : `traffic/discord_bot.py` (commande `!signal` à la demande), volontairement non hébergé par défaut (voir [`traffic/README.md`](traffic/README.md)).
- **Légal** : contenu éducatif, jamais présenté comme un conseil en investissement ; voir [`public/terms.html`](public/terms.html) pour les conditions de vente et [`public/privacy.html`](public/privacy.html) pour la protection des données (RGPD, `/delete_my_data`).
- **Honnête** : aucune statistique de performance inventée — le site masque le taux de réussite du backtest tant que l'échantillon n'est pas statistiquement significatif plutôt que d'afficher un chiffre trompeur (voir `signals/backtest.py`, `MIN_SIGNIFICANT_TRADES`).
