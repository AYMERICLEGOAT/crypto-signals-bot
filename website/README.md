# Générateur de contenu SEO quotidien

Script Python autonome qui génère chaque jour une page HTML présentant les 5
derniers signaux (avec une analyse en français **et en anglais**) et une
section "Performance" basée sur les résultats **réels** des signaux passés,
puis publie le tout sur GitHub — Cloudflare Pages redéploie automatiquement
le site à chaque push.

## 1. Ce que fait le script, dans l'ordre

1. Évalue les signaux passés encore "en attente" : compare leur prix courant
   (via CoinGecko) à leur stop loss / take profit pour déterminer un vrai
   résultat (WIN/LOSS), stocké dans Supabase.
2. Récupère les 5 derniers signaux (envoyés ou non).
3. Génère un paragraphe d'analyse en français par signal, à partir de
   templates décrivant la logique réelle de la stratégie (croisement
   EMA9/EMA21 confirmé par le RSI — c'est la logique réelle qui a produit
   CHAQUE signal BUY/SELL du module `signals/`, pas une donnée inventée).
4. Construit 4 pages HTML : accueil + archive datée, en français
   (`index.html`, `signaux/YYYY-MM-DD.html`) et en anglais
   (`en/index.html`, `en/signals/YYYY-MM-DD.html`), reliées entre elles par
   des balises `hreflang` (SEO multilingue) et un lien de bascule visible.
   Si le module `signals/` a généré un graphique pour un signal
   (`chart_url`), il est affiché directement dans la carte du signal.
5. Met à jour `sitemap.xml` (les 4 pages du jour + tout l'historique) et `robots.txt`.
6. Pousse tous les fichiers sur GitHub via l'API (PyGithub) — crée ou met à
   jour selon qu'ils existent déjà.

## 2. Sur la section "Performance"

⚠️ Important : cette section affiche des **statistiques calculées à partir
de vrais résultats**, jamais un chiffre choisi pour l'occasion. Tant
qu'aucun signal n'est encore résolu, le site l'affiche honnêtement ("en
cours d'évaluation") plutôt que d'inventer un taux de réussite.

Méthode (voir `outcome_evaluator.py`) : un signal est marqué WIN si le prix
courant a atteint son take profit, LOSS s'il a atteint son stop loss, et
LOSS par expiration (timeout, `EVAL_TIMEOUT_DAYS` dans `config.py`, 10 jours
par défaut) s'il n'a touché ni l'un ni l'autre après un certain temps — même
convention conservatrice que le backtest du module `signals/`. C'est une
comparaison au prix **courant** (un instantané quotidien), pas une analyse
tick par tick de tout l'historique intrabar : suffisant pour un site de
contenu, mais à garder en tête si tu veux un calcul de performance de
qualité "audit".

## 3. Prérequis

- Python 3.10+
- Le projet Supabase des modules précédents (`signals`, `users`,
  `pending_payments`) + avoir exécuté [`schema_update.sql`](schema_update.sql)
  une fois (ajoute le suivi des résultats à la table `signals`)
- Un dépôt GitHub (peut être vide au départ) connecté à Cloudflare Pages
  (Pages -> Create a project -> Connect to Git)
- Un token GitHub avec le scope `repo` : https://github.com/settings/tokens

## 4. Installation

```bash
cd website
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env
# Remplis .env (Supabase, token/dépôt GitHub, URL du site, @bot Telegram).
```

## 5. Lancer

```bash
python main.py
```

Une copie locale des fichiers générés est aussi conservée dans `output/`
(pratique pour prévisualiser avant/après publication).

## 6. Planifier l'exécution quotidienne

**Windows (Planificateur de tâches)** :
```
schtasks /create /tn "SEO signaux crypto" /tr "C:\chemin\vers\venv\Scripts\python.exe C:\chemin\vers\website\main.py" /sc daily /st 08:00
```

**Linux/Mac (cron)** :
```
0 8 * * * /chemin/vers/venv/bin/python /chemin/vers/website/main.py
```

Le script n'a besoin de tourner que quelques secondes une fois par jour —
pas besoin qu'il reste actif entre deux exécutions.

## 7. Cloudflare Pages

Rien à faire ici : une fois le dépôt GitHub connecté à un projet Cloudflare
Pages (build command vide, dossier de sortie = racine ou `SITE_SUBDIR` si
configuré), chaque push déclenche automatiquement un nouveau déploiement.

## 8. Structure des fichiers

```
website/
  config.py              Configuration centralisée (.env, paires, seuils)
  supabase_client.py       Accès REST à Supabase (signaux, résultats)
  coingecko_client.py       Prix courants (pour évaluer les résultats passés)
  outcome_evaluator.py      Détermine WIN/LOSS honnêtement + stats agrégées
  content_templates.py      Paragraphes d'analyse FR/EN (templates)
  html_generator.py         Construit la page HTML complète (FR/EN, hreflang)
  sitemap_generator.py      sitemap.xml + robots.txt
  github_publisher.py       Publication sur GitHub (PyGithub)
  main.py                   Orchestration (point d'entrée quotidien)
  schema_update.sql         Colonnes à ajouter à la table `signals` (une fois)
  data/pages_manifest.json  Liste des pages archivées déjà publiées (créé automatiquement)
  output/                   Copie locale des derniers fichiers générés (créé automatiquement)
  requirements.txt
  .env.example
```
