# Journal de croissance — crypto-signals-bot

Journal des actions réelles menées par la routine autonome quotidienne
(`OPS_ROUTINE_PROMPT.md`, section 3.3). Une section datée par run, jamais de
duplication des jours précédents.

## 2026-07-28

**Contexte** : premier run de la routine autonome. Projet très jeune (premiers
utilisateurs le 22/07, 2 utilisateurs au total à ce jour, tous les deux sur le
plan Pro — probablement des comptes de test admin plutôt que des clients
payants réels). Budget du run très largement consommé par la découverte de
bugs de santé/argent (sections 1-2, prioritaires par mandat) et par l'audit
performance du jour (section 6) : pas de temps/budget restant pour lancer de
nouvelles actions d'acquisition (démarchage Reddit/Telegram, annuaires) ce
run. Aucune action de croissance active n'a donc été exécutée aujourd'hui —
préférence donnée à un rapport honnête plutôt qu'un déluge d'actions bâclées.

**Métriques observées** (Supabase, à date) :
- 2 utilisateurs au total, tous deux plan Pro (id 2), aucun essai/Standard/
  Découverte actif, aucun désabonnement (`cancelled`).
- 0 paiement confirmé dans `pending_payments` (business pré-traction / phase
  de test).
- 1 code promo actif : `RELANCE50` (-50%), créé le 25/07 — voir question
  posée à l'admin aujourd'hui (pas de date de fin automatique).
- Aucune donnée exit_surveys/reviews exploitable à ce stade (base trop
  jeune).

**Automatisations déjà en place surveillées** (pas dupliquées, voir rapport
section Santé) :
- Twitter : cassé (403 permissions OAuth1 sur l'app Twitter) — action
  manuelle admin requise sur le Twitter Developer Portal, pas corrigeable
  par du code.
- Discord : OK.
- Reddit : le workflow était vert depuis le début mais ne postait jamais
  rien — les secrets GitHub Actions `REDDIT_CLIENT_ID/SECRET/USERNAME/
  PASSWORD` n'existaient pas du tout (`reddit_daily.py` sort silencieusement
  sans erreur si la config est incomplète, d'où le "succès" trompeur).
  `REDDIT_USER_AGENT` et `REDDIT_SUBREDDITS` (valeurs déjà connues
  localement) ont été poussés vers les secrets GitHub Actions ce run, mais
  `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME` et
  `REDDIT_PASSWORD` sont vides même dans `traffic/.env` local — identifiants
  manquants, à fournir par l'admin (créer une app "script" sur
  reddit.com/prefs/apps) avant que Reddit puisse jamais poster quoi que ce
  soit.

**Optimisation de contenu (3.4)** : base `posted_content` trop récente/peu
fournie pour en tirer un signal fiable sur ce qui performe le mieux. À
refaire une fois quelques semaines de publication accumulées.

**Prochaine étape suggérée** (non exécutée, proposition) : une fois les
identifiants Reddit vérifiés et `REDDIT_SUBREDDITS` renseigné, et Twitter
réparé côté admin, il vaudra la peine de construire un script de démarchage
Telegram/annuaires (aucun script de ce type n'existe encore dans `traffic/`)
plutôt que de se reposer uniquement sur les 3 automatisations existantes.

## 2026-07-29

**Aucune nouvelle action d'acquisition ce run** — priorité donnée à la
fiabilité (sections 1-2) suite au retour direct de l'admin aujourd'hui
(canal qui spamme, alertes bruyantes reçues en direct, doute exprimé sur
l'état général du système). Pousser plus de croissance sur un canal perçu
comme peu fiable serait contre-productif ; voir `OPS_LOG.md` du jour pour
le correctif appliqué (lot d'alertes momentum réduit).

**Identifiants toujours manquants** (inchangé depuis le 28/07) :
`REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD` absents de `traffic/.env` —
Reddit échoue maintenant de façon visible (rouge) au lieu de silencieuse,
ce qui est plus honnête mais ne remplace pas les identifiants. Twitter
toujours cassé côté permissions OAuth1 (action admin requise sur le
Twitter Developer Portal, aucun code ne peut corriger ça).

**Métriques observées** : toujours 2 utilisateurs au total (plan Pro admin
+ 1 essai gratuit expiré aujourd'hui à 07:35 UTC), 0 paiement confirmé, 0
donnée exit_surveys/referral_rewards exploitable — business toujours en
phase pré-traction, rien de nouveau à tirer de l'optimisation de contenu
(3.4) cette semaine.

## 2026-07-31

**Aucune nouvelle action d'acquisition ce run, pour la 3e fois consécutive**
— cette fois la raison a changé : la fiabilité du système est validée
aujourd'hui (signaux + momentum alerts corrigés et vérifiés en conditions
réelles, voir `OPS_LOG.md`), donc ce n'est plus un canal peu fiable qui
bloque. Le vrai blocage reste, inchangé depuis le 28/07 : `REDDIT_CLIENT_ID/
SECRET/USERNAME/PASSWORD` toujours vides dans `traffic/.env` (seuls
`REDDIT_USER_AGENT`/`REDDIT_SUBREDDITS` sont renseignés), et Twitter
toujours cassé côté permissions OAuth1 app (Developer Portal) malgré des
clés API présentes. Aucun des deux ne se corrige par du code — ce sont des
actions manuelles côté admin. Discord (seule automatisation qui tourne
réellement) n'a rien eu de nouveau à publier : aucun nouveau signal généré
depuis le 26/07 tant que le correctif de vitesse n'était pas encore
déployé, donc rien à publier qui ne soit déjà passé.

Plutôt que de forcer une action de croissance artificielle sans canal
fonctionnel, une question a été posée à l'admin (voir `admin_notes` /
rapport Telegram du jour) : prioriser l'obtention des identifiants Reddit +
la réparation Twitter cette semaine, ou mettre volontairement la croissance
active en pause tant que la base (2 comptes, dont 1 de test) ne justifie
pas cet effort.

**Métriques observées** : 2 utilisateurs (1 payant plan Pro = compte admin,
1 essai expiré le 29/07), + 1 compte de test créé aujourd'hui pendant une
session de vérification admin (`111111111`, à ignorer). 0 paiement
confirmé, 0 revenu (`daily_stats`). Rien de nouveau côté `posted_content`
pour l'optimisation (3.4) — toujours trop tôt.

## 2026-08-01

**Aucune nouvelle action d'acquisition ce run, blocage inchangé pour la
4e fois consécutive** : `REDDIT_CLIENT_ID/SECRET/USERNAME/PASSWORD`
toujours vides dans `traffic/.env` (`Publication Reddit` a échoué
explicitement ce matin, run du 01/08 10:12 UTC), Twitter toujours cassé
côté permissions OAuth1 (Developer Portal) malgré les clés API présentes
(`Publication Twitter` a échoué ce matin, run du 01/08 09:47 UTC). Aucun
des deux ne se corrige par du code. Discord (seule automatisation
d'acquisition qui tourne réellement) a publié normalement aujourd'hui.
Plutôt que de reposer une 4e fois la même question sans réponse directe
(posée les 28/07, 29/07 et 31/07), pas de nouvelle relance — la priorité
du jour était ailleurs : l'admin a signalé ce matin (`admin_notes` #7)
être frustré par le manque de signaux et leur qualité, et a explicitement
donné carte blanche ("tu as toutes permissions, rends tout parfait"). Le
run a donc consacré son budget à corriger un vrai bug (perte silencieuse
de ~75% des signaux valides sur cycles cron manqués) et à revalider la
géométrie TP/SL (espérance désormais positive sur les deux derniers
semestres) plutôt qu'à des actions de croissance qui, sans base
d'abonnés significative, seraient prématurées de toute façon.

**Métriques observées** : 3 comptes au total (1 admin plan Standard, 1
essai gratuit réel expiré le 29/07, 1 compte de test créé le 31/07 —
inchangé). 0 paiement confirmé, 0 revenu. `reviews` : 2 votes "up", tous
deux du compte admin, aucun commentaire texte — pas assez de signal pour
l'optimisation de contenu (3.4) ni pour une proposition produit fondée
sur du feedback réel (voir section 5 du rapport du jour à la place).
