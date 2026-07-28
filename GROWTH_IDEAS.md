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
