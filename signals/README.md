# Module de signaux crypto

Génère des signaux ACHAT/VENTE sur 20 paires USDT à partir de l'API
gratuite CoinGecko, avec backtest sur ~6 mois et stockage dans Supabase.
Aucune dépendance payante.

## 1. Prérequis

- Python 3.10+
- Un compte [Supabase](https://supabase.com) gratuit (pas de KYC, juste un email)
- Aucune clé API CoinGecko n'est nécessaire (endpoints publics)

## 2. Installation

```bash
cd signals
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac
pip install -r requirements.txt
```

## 3. Configuration de la base Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. Va dans **SQL Editor** et exécute le contenu de [`schema.sql`](schema.sql) pour créer la table `signals`.
3. Va dans **Project Settings > API** et récupère `Project URL` et la clé `anon` (ou `service_role` si tu préfères insérer sans les règles RLS par défaut — voir section 6).
4. Copie `.env.example` en `.env` et renseigne `SUPABASE_URL` / `SUPABASE_KEY`.

## 4. Lancer le backtest

```bash
python backtest.py
```

Ce script :
- télécharge ~180 jours d'historique OHLC pour chaque paire (1 appel par paire, espacé pour respecter la limite de 10 appels/minute de l'API gratuite),
- teste la stratégie par défaut (EMA 9/21, RSI 14, seuils 40/60),
- si le taux de réussite est < 60 %, lance une recherche automatique sur une petite grille de périodes EMA / seuils RSI,
- écrit les paramètres retenus dans `data/optimized_params.json`. `main.py` les charge automatiquement au démarrage s'ils existent.

⚠️ **Limite technique à connaître** : CoinGecko gratuit ne conserve la granularité 5 minutes que sur les dernières 24h. Au-delà de 90 jours, l'API bascule automatiquement sur des bougies **journalières**. Le backtest 6 mois tourne donc sur des clôtures journalières (un proxy raisonnable de la logique de la stratégie), alors que la boucle temps réel (`main.py`) travaille sur des points ~5 minutes construits au fil de l'eau.

⚠️ **Sur l'optimisation automatique des seuils** : quand `backtest.py` ajuste les paramètres pour atteindre 60 % de réussite, il le fait *sur les mêmes données historiques qui servent à mesurer la performance* (optimisation "in-sample"). Un taux de réussite élevé en backtest ne garantit pas un taux identique en conditions réelles — c'est un risque de surapprentissage connu de toute stratégie optimisée sur données passées. Avant d'agir sur les signaux avec de l'argent réel, il est recommandé de faire tourner le système quelques semaines en observation ("paper trading") et de comparer les signaux générés à la performance réelle du marché.

## 5. Lancer la génération de signaux en temps réel

```bash
python main.py
```

Ce que fait le script :
- toutes les 5 minutes, un seul appel à `/simple/price` récupère le prix des 20 paires,
- chaque prix est ajouté au cache local SQLite (`data/price_cache.db`), qui sert d'historique pour calculer EMA/RSI/Bollinger,
- au tout premier lancement, le cache est amorcé avec l'historique intrajournalier gratuit de CoinGecko (dernières 24h, granularité ~5 min) pour ne pas attendre plusieurs heures avant d'avoir des indicateurs exploitables,
- dès qu'un croisement EMA + confirmation RSI est détecté, un signal est inséré dans la table `signals` de Supabase (`sent = false`).

**Arrêt propre** : `Ctrl+C` (ou `SIGTERM` sous Linux) déclenche un arrêt propre — le cycle en cours se termine, puis le script quitte. Comme le cache est écrit à chaque cycle, redémarrer le script reprend exactement où il s'était arrêté, sans perte d'historique ni recalcul.

**Le script n'a pas besoin de tourner 24h/24** : si le PC est éteint la nuit, il suffit de relancer `python main.py` le lendemain ; le cache local + le bootstrap comblent le trou.

## 6. Graphiques joints aux signaux

Chaque signal est désormais accompagné d'un graphique PNG (prix + EMA9/21 +
niveaux entrée/SL/TP), généré avec matplotlib et hébergé sur Supabase
Storage — les bots (module 2/3) et le module trafic/ l'utilisent pour joindre
une image aux notifications Telegram/Discord.

1. Exécute [`schema_update_chart.sql`](schema_update_chart.sql) (ajoute la colonne `chart_url`).
2. Dans le Dashboard Supabase : **Storage -> New bucket** -> nom `signal-charts`
   -> coche **Public bucket**.
3. Rien d'autre à configurer : `main.py` génère et envoie le graphique
   automatiquement à chaque signal détecté. Si l'envoi échoue (bucket pas
   encore créé, réseau...), le signal est quand même inséré, juste sans
   image — ça ne bloque jamais la génération des signaux.

## 7. Notes sur Supabase et les policies RLS

Par défaut, Supabase active Row Level Security (RLS) sur les nouvelles tables, ce qui peut bloquer les insertions avec la clé `anon`. Deux options :
- utiliser la clé `service_role` (à garder strictement secrète, ne jamais l'exposer côté client) dans `.env` pour ce script serveur, **ou**
- créer une policy explicite autorisant l'insertion, par exemple :

```sql
alter table signals enable row level security;
create policy "allow insert from service" on signals
    for insert
    with check (true);
```

## 8. Structure des fichiers

```
signals/
  config.py              # Paramètres centralisés (paires, seuils, chemins)
  coingecko_client.py     # Client HTTP CoinGecko avec rate-limit + retry
  indicators.py           # EMA, RSI, Bandes de Bollinger (pandas pur)
  strategy.py             # Détection des signaux ACHAT/VENTE
  state_cache.py          # Cache local SQLite (historique de prix, reprise sans perte)
  chart_generator.py       # Génère le PNG (prix + EMA + niveaux) d'un signal
  storage.py              # Insertion des signaux + upload des graphiques dans Supabase
  backtest.py             # Backtest 6 mois + recherche de paramètres
  main.py                 # Boucle temps réel (point d'entrée)
  schema.sql              # Schéma de la table Supabase
  schema_update_chart.sql  # Ajoute la colonne chart_url (à exécuter une fois)
  requirements.txt
  .env.example
  data/                   # Cache SQLite + résultats du backtest (créé automatiquement)
```

## 9. Adapter les paires suivies

Modifie le dictionnaire `PAIRS` dans [`config.py`](config.py) — la clé est l'affichage ("BTC/USDT"), la valeur est l'identifiant CoinGecko (visible dans l'URL de la page de la crypto sur coingecko.com).
