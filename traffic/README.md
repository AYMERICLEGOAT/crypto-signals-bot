# Module d'acquisition de trafic (Twitter / Reddit / Discord)

Publie automatiquement le signal le plus récent sur Twitter, Reddit et
Discord, avec un seul compte légitime par plateforme et les API officielles.
Aucun selfbot, aucune création de comptes multiples, aucun contournement de
CAPTCHA.

## ⚠️ À lire avant d'activer Reddit

Ce module utilise l'API officielle avec ton propre compte Reddit — c'est
légitime. Mais **respecter l'API ne suffit pas à respecter les règles de
chaque subreddit**, qui sont indépendantes des conditions d'utilisation de
Reddit et souvent bien plus strictes :

- La plupart des subreddits crypto (r/CryptoCurrency en tête) interdisent ou
  encadrent fortement les liens vers des bots/canaux payants, et exigent
  souvent un ratio de participation réelle avant tout post promotionnel
  ("règle des 9:1").
- Certains exigent une autorisation préalable des modérateurs pour tout
  contenu automatisé, même bien formulé et espacé.
- Un post qui viole ces règles peut être supprimé ou faire bannir le compte,
  même sans aucune infraction aux conditions d'utilisation de Reddit dans
  leur ensemble.

**Avant d'ajouter un subreddit à `REDDIT_SUBREDDITS`** : lis ses règles
(wiki `/r/<nom>/about/rules`), regarde si l'auto-promotion y est explicitement
autorisée ou encadrée, et envisage de contacter les modérateurs pour
demander leur avis. Le code inclut déjà une ligne de transparence
("je fais partie de l'équipe...") dans chaque post, car la plupart des
subreddits l'exigent — mais ça ne remplace pas la vérification des règles
spécifiques à chaque communauté. Un post supprimé ou un bannissement de
compte n'est pas qu'une gêne : ça peut aussi nuire à la réputation du service
que tu promeus.

## 1. Prérequis

- Le projet Supabase des modules précédents, avec [`schema_update.sql`](schema_update.sql)
  exécuté une fois (table `posted_content`)
- Un compte Twitter/X, un compte Reddit et une application Discord — chacun
  T'APPARTENANT (pas de comptes créés pour l'occasion)

## 2. Installation

```bash
cd traffic
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env
```

## 3. Configurer Twitter/X

1. Crée un compte développeur sur https://developer.twitter.com (gratuit).
2. Crée un projet + une App, en accès **Read and Write**.
3. Récupère les 4 clés (API Key/Secret = consumer key/secret, Access
   Token/Secret) et mets-les dans `.env`.
4. Vérifie la limite de posts/mois affichée dans ton portail développeur et
   ajuste `TWITTER_MAX_PER_MONTH` en conséquence (cette limite a changé
   plusieurs fois par le passé, ne te fie pas à un chiffre codé en dur).

## 4. Configurer Reddit

1. Connecté à ton compte Reddit, va sur https://www.reddit.com/prefs/apps.
2. "Create app" -> type **script**.
3. Renseigne `REDDIT_CLIENT_ID` (sous le nom de l'app), `REDDIT_CLIENT_SECRET`,
   ainsi que `REDDIT_USERNAME`/`REDDIT_PASSWORD` (les identifiants de connexion
   normaux de ce compte).
4. Adapte `REDDIT_USER_AGENT` avec un vrai nom d'utilisateur, comme l'exige
   Reddit (`<usage>/<version> by <ton_pseudo>`).
5. **Relis la section d'avertissement en haut de ce README avant de remplir `REDDIT_SUBREDDITS`.**

## 5. Configurer Discord

1. https://discord.com/developers/applications -> New Application.
2. Onglet **Bot** -> Add Bot -> copie le token dans `DISCORD_BOT_TOKEN`.
3. Toujours onglet Bot -> active **Message Content Intent** (obligatoire
   pour que la commande `!signal` fonctionne).
4. Onglet OAuth2 -> URL Generator -> coche `bot`, permissions `Send Messages`
   + `Read Message History` -> ouvre l'URL générée pour ajouter le bot à TON
   serveur (ou un serveur où tu as la permission).
5. Active le mode développeur Discord (Paramètres -> Avancés) pour pouvoir
   clic-droit sur un canal -> "Copier l'ID" -> `DISCORD_CHANNEL_ID`.

Si le module `signals/` a généré un graphique pour le signal (`chart_url`),
il est automatiquement affiché comme image de l'embed Discord — rien à
configurer ici.

## 6. Lancer

**Publication quotidienne (Twitter + Reddit + Discord, une passe) :**
```bash
python promo_main.py
```
À planifier une fois par jour (Planificateur de tâches Windows, ou cron)
— voir le README du module `website/` pour la syntaxe, identique.

**Mode boucle** (utile pour étaler les tweets sur la journée plutôt qu'en un
seul passage) :
```bash
python promo_main.py --loop
```

**Bot Discord avec la commande `!signal` à la demande** (processus séparé,
à laisser tourner en continu — sinon le message quotidien Discord suffit
déjà via `promo_main.py`, sans la commande) :
```bash
python discord_bot.py
```

## 7. Logs

Toutes les actions (et erreurs) sont écrites dans `data/promo.log`, en plus
de la sortie console.

## 8. Structure des fichiers

```
traffic/
  config.py               Configuration centralisée (.env)
  supabase_client.py        Accès Supabase (SDK officiel) : dernier signal, historique de publication
  content_templates.py      Contenu par plateforme (tweet, post Reddit, embed Discord)
  twitter_publisher.py       publish_to_twitter(signal) — plafonds jour/mois, délai aléatoire
  reddit_publisher.py        publish_to_reddit(signal) — délai mini, rotation des subreddits
  discord_publisher.py       publish_to_discord(signal) — envoi REST, sans connexion persistante
  discord_bot.py             Bot persistant optionnel (message quotidien + commande !signal)
  promo_main.py               Orchestrateur (une passe, ou --loop)
  schema_update.sql           Table posted_content (historique de publication)
  requirements.txt
  .env.example
```
