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
