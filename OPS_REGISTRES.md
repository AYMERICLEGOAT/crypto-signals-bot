# Registres opérationnels de crypto-signals-bot

Trois inventaires tenus par la routine quotidienne (`OPS_ROUTINE_PROMPT.md`).
Ils ne sont pas une liste de contrôle de plus : ce sont des **inventaires
vivants**, et leur incomplétude est elle-même une trouvaille.

Une liste de contrôle ne trouve que ce qu'on a pensé à y mettre. Ces registres
sont conçus pour que la routine découvre ce qu'on n'y a PAS mis.

---

## Registre 1 — Les observables

**La règle :** toute capacité du produit doit laisser une trace vérifiable. Une
capacité sans observable est une panne silencieuse en puissance — celle de
demain.

Chaque passage : exécuter le registre, traiter les absences, **puis chercher les
capacités qui n'y figurent pas encore.**

### Argent

| Capacité | Trace observable | Fréquence attendue | Absence = quoi |
|---|---|---|---|
| Scan des transferts USDT | `chain_state.last_processed_block_usdt_transfers` avance | à chaque cycle de 5 min | détection morte, aucun paiement vu |
| Confirmation de paiement | `pending_payments.status = confirmed` puis message | à chaque paiement | payé sans accès |
| Alerte paiement anormal | message à `ADMIN_TELEGRAM_ID` | à chaque anomalie | argent reçu, personne prévenue |
| Pool d'adresses Litecoin | `litecoin_address_pool` avec `used = false` | toujours non vide | paiement LTC impossible |

### Livraison

| Capacité | Trace observable | Fréquence attendue | Absence = quoi |
|---|---|---|---|
| Signal → abonnés | lignes dans `signal_deliveries` | à chaque signal, si ≥1 abonné actif | **marqué envoyé, reçu par personne** |
| Signal → canal public | `signals.sent_to_channel` + `channel_posts` | 30 min après émission, hors heures calmes | vitrine muette |
| Clôture → abonnés | message + `signals.outcome` renseigné | à échéance ou seuil touché | l'abonné ne sait pas où il en est |
| Clôture → canal public | `channel_posts` catégorie `resultat` | à chaque clôture d'un signal publié | le relevé public devient faux par omission |
| Échantillon hebdo complet | heartbeat `signal_complet_public` | une fois par semaine | plus aucune preuve vérifiable en direct |

### Moteurs

| Capacité | Trace observable | Fréquence attendue | Absence = quoi |
|---|---|---|---|
| Cycle de génération | heartbeat `signals` | toutes les 30 min | plus aucun signal produit |
| Force relative | heartbeat `relative_strength` | quotidien | normal si filtre fermé — le dire |
| Carry de financement | heartbeat `carry_funding` | quotidien | normal si financement plat — le dire |
| Momentum 4H | heartbeat `momentum_4h` | quotidien en marché baissier | seul moteur actif aujourd'hui |

### Canaux et cycle de vie

| Capacité | Trace observable | Fréquence attendue | Absence = quoi |
|---|---|---|---|
| Briefing VIP | heartbeat `vip_briefing` | quotidien après 8 h UTC | le canal payant ne dit plus rien |
| Mouvements du jour (VIP) | heartbeat `momentum_digest_vip` | **silencieux depuis le 10/08, et c'est voulu** | ne pas signaler : le moteur source est désactivé et la file a une borne de fraîcheur de 24 h |
| Bilan de sélectivité | heartbeat `selectivity_digest` | quotidien après 18 h UTC | — |
| Rappel de canal | heartbeat `channel_reminder` | max 1 / 8 h, supprimé si signal récent | — |
| Récap hebdomadaire | `channel_posts` référence `recap-hebdo` | dimanche après 18 h UTC | — |
| Retrait VIP à expiration | `users.vip_removed` passe à vrai | à chaque expiration | accès gratuit à vie |
| Séquence de bienvenue | `welcome_1h_sent`, `welcome_1d_sent` | après inscription | nouveau venu abandonné |
| Récap de mi-essai | `trial_recap_sent` | 24 h après début d'essai | conversion perdue |
| Rappels d'expiration | `reminder_48h_sent`, `_24h_`, `_2h_` | avant échéance | expiration subie, pas choisie |
| Relance de réabonnement | `reengagement_sent` | J+3 après expiration | — |

### Infrastructure

| Capacité | Trace observable | Fréquence attendue | Absence = quoi |
|---|---|---|---|
| Worker vivant | `/health` répond 200 | permanent | bot mort |
| Cron `*/5` | log `"*/5 * * * *" — Ok` | toutes les 5 min | signaux et paiements gelés |
| Cron `*/15`, 4 créneaux | heartbeats des tâches de chaque groupe | une fois par heure chacun | rétention morte |
| CI | `tests.yml` vert après push | à chaque poussée | régression non détectée |
| Sauvegarde | run `backup.yml` réussi avec lignes > 0 | hebdomadaire | pas de reprise possible |
| Site régénéré | `website.yml` réussi | quotidien | SEO figé |
| **Cette routine** | `ops_routine.log` sans motif d'échec | quotidien à 14:00 | **plus personne ne surveille** |

### À déclarer — capacités sans observable identifié

*(à compléter par la routine : c'est ici que se trouvent les prochaines pannes)*

- Envoi du trailing stop (opt-in) — aucune trace distincte aujourd'hui
- Message anti-stress après pertes consécutives — aucune trace distincte
- Alertes de suspension pour volatilité — colonne réelle : `volatility_suspensions.sent_to_channel`

---

## Registre 2 — Les promesses

Chaque affirmation publique et sa source de vérité. Une divergence est un
correctif immédiat, pas une note.

| Ce qui est affirmé | Où | Source de vérité |
|---|---|---|
| 4,0 / 3,1 / 3,6 signaux par jour | `/subscribe`, `/help`, site | `publishedStats.DEBIT` |
| Filtre fermé 42 % du temps | partout | `publishedStats.PART_FILTRE_FERME` |
| 93 % des jours ont un signal | `/subscribe`, site | `publishedStats.PART_JOURS_AVEC_SIGNAL` |
| Maximum 8 signaux par jour | `/demo`, site | `publishedStats.MAX_PAR_JOUR` |
| Momentum 4H : +0,805 % / 3 j | signaux, `/status`, `/faq` | `publishedStats.MOMENTUM_4H` |
| Carry : 84,2 % gagnants, +0,572 % | `/subscribe`, `/demo`, `/help` | `signals/backtest_carry_stop.py` |
| Cinq moteurs | partout | `signals/main.py` |
| Mensuel 19 / Trimestriel 45 / Découverte 5 / À vie 99 | `/subscribe`, boutons | `payments/plans.ts` |
| Essai gratuit de 3 jours | partout | `commands/trial.ts` |
| Places Découverte limitées à 50 | `/subscribe` | `offer_counter` — compteur RÉEL |
| Signaux republiés à la clôture | description du canal, épinglé, teasers | `trackSignalOutcomes` |
| Canal VIP = briefing quotidien | `/vip` | `dispatchVipBriefing` — **pas de signaux** |

**Promesses à surveiller particulièrement :** celles qui étaient vraies et ne le
sont plus. C'est la forme la plus dangereuse — elle n'a jamais été fausse au
moment où on l'a écrite.

---

## Registre 3 — Les pièges

Chaque défaut corrigé, et ce qui rattraperait son retour.

| Défaut | Date | Ce qui le rattraperait aujourd'hui |
|---|---|---|
| Légende photo > 1024 → signal perdu | 10/08 | `legendePhoto.test.ts`, `contratMessages.test.ts` |
| Scan USDT à −300 000 blocs → jamais de paiement | 10/08 | `usdtScanElagage.test.ts` |
| Rattrapage USDT → saturation sous-requêtes | 10/08 | test de borne `MAX_CHUNKS_PER_RUN` |
| Paiement anormal → silence total | 10/08 | `paiementsSansSuite.test.ts` |
| Chaîne `*/15` saturée → 8 tâches mortes | 10/08 | `repartitionCron.test.ts` |
| Alertes périmées du moteur retiré sur le VIP | 10/08 | borne de fraîcheur 24 h |
| Texte libre → aucune réponse | 10/08 | `toutesLesCommandes.test.ts` |
| Webhook sans secret → 500 au lieu de 401 | 09/08 | `timingSafeEqual.test.ts` |
| Suite dépendante des secrets locaux | 09/08 | bindings dans `vitest.config.ts` |
| Drapeau `PRO_PLAN_VISIBLE` masquant le palier phare | 09/08 | `pricingAndSniper.test.ts` |
| Boucle infinie du récap de mi-essai | 08/08 | `trialMidpointRecap.test.ts` |
| `return query` plpgsql sans `return` | 09/08 | limite mesurée à 10/min |
| Discord planté sur les carrys | 09/08 | `test_discord_embed.py` |
| RLS désactivé sur 35 tables | 09/08 | advisors Supabase |
| Aucun test en CI | 09/08 | `tests.yml` |

**Sans garde-fou en troisième colonne, le défaut reviendra.** Écrire le test
manquant vaut mieux que n'importe quelle amélioration.

---

### Heartbeats morts, à ne pas poursuivre

Ces entrées existent en base mais ne correspondent plus à rien d'actif. Les
signaler chaque jour ferait perdre du temps :

- `preflight_reddit`, `preflight_twitter-auth` — canaux fermés définitivement
- `channel_pinned` — remplaé par `channel_pinned_v2` (versionnement du pin)
- `watchlist` — lié à la liste du jour, publiée par le module Python

---

## Registre 4 — Les questions sans réponse

`admin_notes` où `sender = 'routine'` et `read_at is null`. Cinq questions y ont
attendu sans réponse entre le 29/07 et le 03/08.

Relis-les avant d'en poser une nouvelle : une question répétée sans réponse
signifie qu'elle est mal posée, ou qu'elle demande une décision que le
propriétaire ne veut pas prendre. Dans les deux cas, reformule ou décide
toi-même dans les limites de l'échelle d'autonomie.
