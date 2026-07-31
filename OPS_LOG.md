# OPS_LOG — routine autonome quotidienne

## 2026-07-28
Premier run de la routine. Corrigé : retry Binance inutile sur 451 (blocage
géo permanent depuis GitHub Actions, retenté 3x sur chaque paire pour rien —
~8 des 9 minutes du run signals.yml) et poussé `REDDIT_USER_AGENT`/
`REDDIT_SUBREDDITS` en secrets GitHub Actions (le workflow Reddit était vert
depuis le début mais ne postait jamais rien, secrets d'auth absents).
Trouvé sans corriger : Twitter cassé (permissions OAuth1 app, action manuelle
Twitter Developer Portal requise), credentials Reddit d'auth
(CLIENT_ID/SECRET/USERNAME/PASSWORD) absentes même en local, protection
anti-auto-parrainage inefficace pour les paiements Monero/Litecoin (ne
compare que `wallet_address`, jamais renseigné hors USDT), promo RELANCE50
actif sans date de fin (question posée à l'admin).

## 2026-07-29
Admin a répondu (via `/opsnote`) : laisser RELANCE50 actif indéfiniment
(décision business assumée, plus de question à reposer) — a aussi signalé
en vrac que le canal public envoie parfois ~40 messages d'un coup et reçoit
trop d'alertes bruyantes (RPC Polygon, échec Reddit). Corrigé : lot
d'alertes momentum par cycle de cron réduit de 20 à 5
(`dispatchMomentumAlerts.ts`) pour étaler un retard sur plusieurs cycles
plutôt que de vider la pile d'un coup — correspond exactement au pattern
signalé. Déployé en prod (`wrangler deploy`), `/health` revérifié après
coup. Trouvé sans corriger (bloqué) : Reddit échoue maintenant
explicitement (avant : "succès" silencieux) faute de
CLIENT_ID/SECRET/USERNAME/PASSWORD toujours absents ; Twitter toujours
cassé (action manuelle admin requise) ; anti-auto-parrainage XMR/LTC
toujours inefficace ; `/delete_my_data` efface moins que ce que
`privacy.html` laisse penser (trial_used/discovery_used conservés, pas
explicitement documentés comme exception) ; `privacy.html` ne mentionne
pas le RGPD explicitement. `npm test` cassé dans cet environnement local
(bug d'infra `@cloudflare/vitest-pool-workers`/vitest sur un chemin
Windows contenant des espaces, confirmé indépendant de tout changement de
code par git stash) — vérifié le correctif par `tsc --noEmit` + relecture
manuelle à la place, `wrangler deploy` a réussi. Aucun signal généré
depuis 65h au moment du run (2 signaux au total depuis le début) : pas de
bug identifié (pas de pause/verrou actif, juste 0 candidat), mais tous les
cycles retombent désormais sur CoinGecko (Binance bloqué géo en
permanence) qui rate-limite ~4 paires/cycle — à surveiller, cause
plausible d'une baisse de fréquence de détection.

## 2026-07-31
Note de tenue : le run du 30/07 (commit "Audit#32") a corrigé 4 bugs urgents
(vitesse signals.yml Binance/CoinGecko -> Coinbase/Kraken, spam momentum
`sent_at` vs `created_at`, post éducatif reçu à 22h, épinglage canal) mais
n'avait pas mis à jour ce journal — comblé ici a posteriori. Aujourd'hui,
**validé en conditions réelles** : run `signals.yml` manuel après déploiement
du correctif = 23s pour 40/40 paires (contre ~8 min avant, Kraken/Coinbase
répondent bien en repli de Binance qui reste bloqué géographiquement) ;
alertes momentum bien plafonnées à 8/jour comme prévu (8/8 envoyées
aujourd'hui, le reste en attente pour demain, aucune perdue). Trouvé et
corrigé : `bot/commands/trial.ts::activateTrialForWallet` marquait
`trial_used=true` AVANT d'activer l'abonnement, sans rollback — un échec
Supabase transitoire entre les deux aurait bloqué définitivement un
utilisateur honnête (plus jamais retentable via /trial). Ordre inversé.
Audit thématique du jour (vendredi = schéma) : comparaison exhaustive
colonnes code vs schéma Supabase LIVE (OpenAPI) sur les tables les plus
utilisées — aucun mismatch trouvé, rien à corriger. Trouvé sans corriger :
les 2 seuls signaux existants (#2 LTC, #3 DOGE, format legacy pré-multi-TP)
restent ouverts depuis le 26/07 avec `last_status_update_at` toujours nul —
possiblement normal (ni TP/SL ni mouvement favorable au trailing stop en 5
jours) mais impossible de confirmer avec certitude que
`trackSignalOutcomes`/Binance répond bien depuis le Worker : `wrangler tail`
et `wrangler deploy` ont tous les deux échoué ce run sur des erreurs 520-522
côté API de gestion Cloudflare (panne transitoire confirmée, `/health` du
Worker restait pourtant 200 en direct) — le correctif trial.ts est committé
mais PAS ENCORE déployé, à refaire (`wrangler deploy`) dès que l'API
Cloudflare répond normalement. Croissance : toujours 0 client réel (2
comptes, dont 1 de test admin créé aujourd'hui), Reddit/Twitter toujours
bloqués par des identifiants/permissions côté admin (3e jour identique) —
question posée à l'admin pour trancher (prioriser ou mettre en pause).
