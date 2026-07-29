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
