# Module de signaux crypto

Génère des signaux ACHAT/VENTE sur l'univers de paires USDT défini dans
`config.py` à partir d'une source de données hybride à 4 niveaux (Binance
-> CoinGecko -> Coinbase Exchange -> Kraken, chaque niveau tenté seulement
si le précédent échoue), avec backtest sur ~24 mois et stockage dans
Supabase. Aucune dépendance payante ni clé API.

Exécuté en production via **GitHub Actions**, une fois par heure (voir
[`.github/workflows/signals.yml`](../.github/workflows/signals.yml) à la
racine du dépôt) — aucun serveur ni machine locale ne doit rester allumée.

## 1. Prérequis

- Python 3.10+
- Un compte [Supabase](https://supabase.com) gratuit (pas de KYC, juste un email)
- Aucune clé API n'est nécessaire pour aucune des 4 sources de données (endpoints publics)

## 2. Installation (développement local uniquement)

```bash
cd signals
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Linux/Mac
pip install -r requirements.txt
```

En production, ce n'est pas nécessaire : le workflow GitHub Actions installe
les dépendances lui-même à chaque exécution.

## 3. Configuration de la base Supabase

1. Crée un projet sur [supabase.com](https://supabase.com).
2. Va dans **SQL Editor** et exécute [`../init.sql`](../init.sql) (schéma
   complet du projet) — ou, si tu veux juste ce module, [`schema.sql`](schema.sql)
   + [`schema_update_chart.sql`](schema_update_chart.sql) + [`schema_strategy_params.sql`](schema_strategy_params.sql).
3. Va dans **Project Settings > API** et récupère `Project URL` et la clé
   `service_role` (voir section 7 sur les policies RLS).
4. En local : copie `.env.example` en `.env` et renseigne `SUPABASE_URL` /
   `SUPABASE_KEY`. En production : ces deux valeurs sont posées comme
   *secrets* du dépôt GitHub (`Settings > Secrets and variables > Actions`),
   lus par `.github/workflows/signals.yml`.

## 4. Lancer le backtest

```bash
python backtest.py
```

Ce script :
- télécharge ~730 jours (24 mois) de bougies **horaires réelles** via l'API
  Binance, sur les 20 paires de `config.py` (`BACKTEST_PAIRS` en dérive
  directement),
- teste la stratégie active (EMA 9/21, RSI 14, seuils 40/60 par défaut),
- mesure le taux de réussite, le ratio gain/perte et le drawdown maximum,
- si l'échantillon est trop petit (< 15 trades) OU le taux de réussite
  < 60 %, lance une recherche automatique sur une grille de périodes EMA /
  seuils RSI, et retient la meilleure combinaison suffisamment significative,
- enregistre le résultat retenu dans la table Supabase `strategy_params`
  (une seule ligne `is_active = true` à la fois). `main.py` la charge
  automatiquement à sa prochaine exécution — plus besoin de fichier local
  (les runners GitHub Actions repartent de zéro à chaque fois).

⚠️ **Sur la taille de l'échantillon (constat honnête, Audit#4)** : EMA9/21 +
confirmation RSI est un événement rare sur cet univers de 20 paires — même
sur 24 mois de bougies horaires et après avoir assoupli le filtre
anti-corrélation, le dernier run ne produit qu'une dizaine de trades
indépendants, sous le seuil de significativité (`MIN_SIGNIFICANT_TRADES = 15`).
Le script le signale clairement (WARNING) plutôt que d'afficher un taux de
réussite trompeur, et le site/bot masquent le pourcentage tant que ce seuil
n'est pas atteint. Pousser encore la fenêtre au-delà de 24 mois ne
résoudrait pas le problème (certaines paires plus récentes n'ont pas cet
historique sur Binance) — c'est une limite structurelle de la fréquence du
signal sur cet univers de paires, pas un bug de configuration.

⚠️ **Sur l'optimisation automatique** : elle se fait *in-sample* (sur les
mêmes données qui servent à mesurer la performance). Un taux de réussite
élevé en backtest ne garantit pas un taux identique en conditions réelles
(surapprentissage). Avant d'agir sur les signaux avec de l'argent réel, il
est recommandé d'observer le système quelques semaines en "paper trading"
et de comparer les signaux générés à la performance réelle du marché.

## 5. Génération des signaux en production (GitHub Actions)

Le point d'entrée [`main.py`](main.py) fait une **exécution unique** (pas
de boucle) :

- pour chacune des paires, récupère les ~250 dernières bougies horaires via
  la source hybride à 4 niveaux (Binance -> CoinGecko -> Coinbase Exchange
  -> Kraken, voir `main.py::fetch_recent_prices`),
- calcule les indicateurs à partir de cet historique frais (aucun état
  local à conserver entre deux exécutions),
- dès qu'un croisement EMA + confirmation RSI est détecté, insère un signal
  dans la table `signals` de Supabase (`sent = false`) avec son graphique.

`.github/workflows/signals.yml` déclenche `python main.py` toutes les
heures (`cron: "0 * * * *"`) + à la demande (`workflow_dispatch`).

**Lancer un cycle manuellement en local** (pour tester) :

```bash
python main.py
```

## 6. Graphiques joints aux signaux

Chaque signal est accompagné d'un graphique PNG (prix + EMA9/21 + niveaux
entrée/SL/TP), généré avec matplotlib et hébergé sur Supabase Storage — les
bots (module 2/3) et le module trafic/ l'utilisent pour joindre une image
aux notifications Telegram/Discord.

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
  config.py                    # Paramètres centralisés (paires, seuils, chemins)
  binance_client.py            # Client HTTP Binance (niveau 1, sans clé)
  coingecko_client.py          # Client HTTP CoinGecko (niveau 2, repli)
  coinbase_client.py           # Client HTTP Coinbase Exchange (niveau 3, repli)
  kraken_client.py             # Client HTTP Kraken (niveau 4, dernier repli)
  alerts.py                    # Alerte Telegram admin si les 4 sources échouent 3 cycles de suite
  indicators.py                # EMA, RSI, Bandes de Bollinger (pandas pur)
  strategy.py                  # Détection des signaux ACHAT/VENTE
  params_store.py              # Lecture/écriture des paramètres actifs (Supabase)
  chart_generator.py           # Génère le PNG (prix + EMA + niveaux) d'un signal
  storage.py                   # Insertion des signaux + upload des graphiques dans Supabase
  backtest.py                  # Backtest 24 mois (Binance) + recherche de paramètres
  main.py                      # Exécution unique (point d'entrée GitHub Actions)
  schema.sql                   # Schéma de la table `signals`
  schema_update_chart.sql      # Ajoute la colonne chart_url
  schema_strategy_params.sql   # Table `strategy_params` (paramètres actifs)
  requirements.txt
  .env.example
  data/                        # Résultats locaux du backtest (créé automatiquement, dev uniquement)
```

## 9. Adapter les paires suivies

Modifie le dictionnaire `PAIRS` dans [`config.py`](config.py) — la clé est
l'affichage ("BTC/USDT"), la valeur est l'identifiant CoinGecko (utilisé
uniquement pour le repli ; le symbole Binance est dérivé automatiquement de
la clé, ex: "BTC/USDT" -> "BTCUSDT").
