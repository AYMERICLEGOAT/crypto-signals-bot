# Module d'acquisition de trafic (Discord)

Publie automatiquement le signal le plus récent sur Discord, avec un lien vers
le canal Telegram public.

## Twitter et Reddit ont été retirés le 08/08/2026

Ils tournaient tous les jours et ne publiaient rien.

- **Twitter/X** rendait `403 Forbidden` à chaque tentative — identifiants
  refusés par la plateforme. Le workflow attendait jusqu'à 17 minutes avant
  d'échouer, puis envoyait une alerte Telegram à l'administrateur. Tous les
  jours, depuis au moins le 29/07.
- **Reddit** n'avait aucun identifiant configuré. Il journalisait une erreur
  puis sortait en code 0, donc le workflow apparaissait **vert** sans avoir
  rien fait.

Le coût réel n'était pas le temps de runner : c'était l'alerte quotidienne. Une
alerte qui se répète tous les jours sans que rien ne change apprend à ignorer
les alertes — y compris celle qui signalera une vraie panne.

Ces canaux ne reviendront pas. Le code correspondant (`twitter_publisher.py`,
`reddit_publisher.py`, `twitter_daily.py`, `reddit_daily.py`, `preflight.py`,
`promo_main.py`) a été supprimé plutôt que laissé en sommeil : du code
d'acquisition qui ne s'exécute jamais finit par décrire un produit qui n'existe
plus. Les gabarits Reddit décrivaient d'ailleurs encore le croisement EMA9/21 +
RSI, la stratégie mesurée **perdante** et désactivée depuis le 03/08/2026.

## 1. Prérequis

- Le projet Supabase des modules précédents, avec [`schema_update.sql`](schema_update.sql)
  exécuté une fois (table `posted_content`)
- Une application Discord T'APPARTENANT (pas un compte créé pour l'occasion)

## 2. Installation

```bash
cd traffic
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

## 3. Configurer Discord

1. Crée une application sur https://discord.com/developers/applications
2. Onglet **Bot** > crée le bot > copie le token dans `DISCORD_BOT_TOKEN`
3. Invite le bot sur ton serveur avec la permission « Envoyer des messages »
4. Active le mode développeur dans Discord, clic droit sur le salon > « Copier
   l'identifiant » > `DISCORD_CHANNEL_ID`

Pour la commande `!signal` uniquement, active aussi **MESSAGE CONTENT INTENT**
dans l'onglet Bot (Privileged Gateway Intents) — sans ça, le bot ne reçoit pas
le contenu des messages.

## 4. Publication quotidienne

Automatique via GitHub Actions (`.github/workflows/discord.yml`). Manuellement :

```bash
python discord_daily.py
```

## 5. Bot Discord avec la commande `!signal` (optionnel)

```bash
python discord_bot.py
```

⚠️ **Ce processus ne tourne PAS automatiquement dans ce projet.** GitHub
Actions est fait pour des tâches ponctuelles et planifiées, pas pour un
processus qui doit rester connecté en continu — un job y est de toute façon
coupé après un délai maximum. Il n'y a donc, volontairement, aucun workflow
pour `discord_bot.py`. Trois choix honnêtes :

1. **Ne pas l'utiliser** (recommandé pour rester 100 % gratuit et
   automatique) : le message quotidien fonctionne déjà sans lui, seule la
   commande `!signal` à la demande serait absente — un manque mineur.
2. L'héberger sur un service à niveau gratuit adapté aux processus longs
   (Railway, Fly.io, Render…) — ajoute un compte externe à gérer.
3. Le lancer manuellement sur une machine perso quand tu veux la commande
   `!signal` ponctuellement, sans viser une disponibilité continue.

## 6. Logs

Toutes les actions (et erreurs) sont écrites dans `data/promo.log`, en plus de
la sortie console.

## 7. Structure des fichiers

```
traffic/
  config.py                 Configuration centralisée (.env)
  supabase_client.py        Accès Supabase : dernier signal, historique de publication
  content_templates.py      Contenu de l'embed Discord
  discord_publisher.py      publish_to_discord(signal) — envoi REST, sans connexion persistante
  discord_daily.py          Point d'entrée du workflow quotidien
  discord_bot.py            Bot persistant optionnel (commande !signal)
  macro_summary.py          Résumé macro publié les jours sans signal
  directory_submit.py       Soumission aux annuaires de bots
  schema_update.sql         Table posted_content (historique de publication)
  requirements.txt
  .env.example
```
