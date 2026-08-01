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

## 2026-08-01
Journée dominée par un message admin urgent (`admin_notes` #7, 11h02 :
"pas eu de signaux depuis une semaine", carte blanche totale). Deux gros
correctifs faits en amont de ce run (mêmes fichiers, même journée) :
(1) `detect_signals_with_catchup()` — le cron horaire ne partait qu'~12
fois/jour au lieu de 24 (best-effort GitHub Actions), et chaque bougie
manquée perdait ses croisements pour toujours ; balaie désormais les 6
dernières bougies avec garde-fou `is_still_actionable()` pour ne jamais
annoncer une entrée déjà dépassée par le marché (voir
`signals/DIAGNOSTIC_SIGNAUX_2026-08-01.md`, 1600 comparaisons de
non-regard-vers-le-futur vérifiées dans `test_catchup.py`) ; (2) géométrie
TP/SL rééquilibrée (G6 : SL 1.2/TP 1.3-3.5-6.0 ATR, poids 0.3/0.3/0.4) —
l'ancienne perdait de l'argent en walk-forward sur le semestre récent
(+0.065%→-0.029%/trade, ratio gain/perte 0.67), la nouvelle est positive
sur les deux semestres (+0.128%/+0.031%) et le drawdown baisse (45%→41%).
Ajout de `edge_guard.py` : suspend automatiquement la génération si
l'espérance RÉALISÉE (signaux clôturés, pas le backtest) devient nettement
négative sur ≥30 trades — motif : l'érosion passée ne déclenchait aucune
alarme, le win rate restant flatteur. Exploré et **refusé** : assouplir les
seuils RSI pour produire plus de signaux (6x plus de volume en walk-forward
mais amplificateur de régime, perd plus que la production actuelle en
période défavorable malgré une meilleure espérance apparente).

Routine du jour (sections 1-9) : santé et argent vérifiés sains (Worker
`/health` 200, webhook Telegram propre, heartbeat signals à jour, 5
workflows GitHub Actions verts sauf Reddit/Twitter — échecs déjà connus
et non liés au code), aucune anomalie `pending_payments` (0 paiement
confirmé au total, business toujours pré-traction : 3 comptes, 0 client
payant réel), prix cohérents partout (`plans.ts`/`terms.html`/boutons du
bot dérivent tous de la même source), `strategy_params` actif sain
(G6, walk-forward validé). Page transparence vérifiée honnête (affiche
"n/a" faute de signaux clôturés plutôt qu'un chiffre trompeur). `npm test`
toujours cassé localement (même bug d'infra chemin Windows avec espaces,
confirmé indépendant du code) — vérifié par `tsc --noEmit` (propre) à la
place. Note admin #7 marquée lue ; question du jour posée en retour
(`admin_notes` #8) : confirmer l'arbitrage qualité/fiabilité plutôt que
volume brut de signaux. Croissance : aucune action nouvelle, blocage
Reddit/Twitter inchangé pour la 4e fois (voir `GROWTH_IDEAS.md`) — budget
du run à juste titre consacré à l'urgence signalée par l'admin plutôt qu'à
la croissance, une base de 0 client payant ne le justifiant pas encore.
Proposé sans implémenter (section 5, 1er du mois) : publier l'espérance
réalisée (`edge_guard`) sur la page transparence plutôt que seulement le
taux de réussite backtest, pour rendre visible la préférence qualité que
l'admin n'a pas explicitement validée.
