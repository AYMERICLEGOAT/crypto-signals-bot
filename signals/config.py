"""
Configuration centrale du module de signaux.
Toutes les valeurs modifiables (paires, seuils, périodes) sont ici pour
éviter d'avoir à toucher au code métier.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- Supabase (base de données) ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# --- Alerte admin directe (voir alerts.py) ---
# Optionnels : en dev local sans ces variables, l'alerte est simplement
# journalisée au lieu d'être envoyée (voir alerts.maybe_alert_data_outage).
# TELEGRAM_BOT_TOKEN est le même secret que celui du Worker/bot Telegram ;
# ADMIN_TELEGRAM_ID n'est pas un secret (déjà visible en clair dans
# workers/main-worker/wrangler.toml et .github/workflows/signals.yml).
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
ADMIN_TELEGRAM_ID = os.getenv("ADMIN_TELEGRAM_ID", "8647576528")

# Système hybride de sources de données (voir main.py::fetch_recent_prices) :
# nombre de cycles horaires consécutifs en panne totale (0 paire sur
# l'univers entier avec une donnée exploitable, les 4 sources ayant échoué)
# avant d'alerter l'admin -- voir storage.record_source_health.
DATA_OUTAGE_ALERT_THRESHOLD_CYCLES = 3

# --- CoinGecko ---
COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
# Limite d'appels/minute à respecter pour rester sur le plan gratuit sans clé API.
# Abaissé de 10 à 5 (2026-07-29) : depuis que Binance bloque géographiquement
# (451) TOUS les appels depuis les runners GitHub Actions, les 28 paires de
# l'univers retombent chacune sur CoinGecko à chaque cycle horaire, contre
# seulement quelques-unes avant. Le quota officiel CoinGecko gratuit
# (~10-30/min) est en réalité partagé par IP entre tous les jobs GitHub
# Actions en cours (pas seulement les nôtres) : même avec un throttle
# client-side "10/min", on se prenait des 429 en rafale et plusieurs paires
# échouaient définitivement chaque heure ("Échec du repli CoinGecko"),
# réduisant silencieusement la couverture réelle et donc les signaux
# détectables. Marge de sécurité : le cron tourne 1x/heure, on a largement
# le temps même à 5/min (28 paires x quelques appels chacune).
COINGECKO_MAX_CALLS_PER_MINUTE = 5

# 20 paires les plus tradées, mappées vers leur identifiant CoinGecko.
# Format : "SYMBOLE/USDT" -> "id_coingecko"
PAIRS = {
    "BTC/USDT": "bitcoin",
    "ETH/USDT": "ethereum",
    "SOL/USDT": "solana",
    "BNB/USDT": "binancecoin",
    "XRP/USDT": "ripple",
    "ADA/USDT": "cardano",
    "DOGE/USDT": "dogecoin",
    "AVAX/USDT": "avalanche-2",
    "DOT/USDT": "polkadot",
    "LINK/USDT": "chainlink",
    # Polygon a migré son token MATIC -> POL en 2024 ; Binance a délisté
    # MATICUSDT en conséquence (dernière bougie ~sept. 2024). "polygon-ecosystem-token"
    # est l'identifiant CoinGecko courant pour POL (ex-MATIC).
    "POL/USDT": "polygon-ecosystem-token",
    "LTC/USDT": "litecoin",
    "SHIB/USDT": "shiba-inu",
    "UNI/USDT": "uniswap",
    "ATOM/USDT": "cosmos",
    "NEAR/USDT": "near",
    "APT/USDT": "aptos",
    "ARB/USDT": "arbitrum",
    "OP/USDT": "optimism",
    # Univers élargi à 28 paires (verrou de portefeuille MAX_ACTIVE_TRADES,
    # voir plus bas) : TRX/USDT retiré (remplacé par des paires plus
    # récentes testées ensemble en backtest 24 mois), FIL/USDT et 8 paires
    # supplémentaires ajoutées.
    "SUI/USDT": "sui",
    "FET/USDT": "fetch-ai",
    "PEPE/USDT": "pepe",
    "RENDER/USDT": "render-token",
    "INJ/USDT": "injective-protocol",
    "TIA/USDT": "celestia",
    "TAO/USDT": "bittensor",
    "STX/USDT": "blockstack",
    "FIL/USDT": "filecoin",
    # Univers élargi à 40 paires (backtest 12 mois validé, voir
    # backtest_squeeze.py) : 12 paires liquides et anciennes (historique
    # Binance >= 2022) ajoutées pour augmenter la fréquence de signaux sans
    # toucher aux 28 déjà en place. Sélectionnées aussi pour leur bonne
    # couverture Coinbase/Kraken (source hybride, voir main.py).
    "VET/USDT": "vechain",
    "ALGO/USDT": "algorand",
    "ICP/USDT": "internet-computer",
    "ETC/USDT": "ethereum-classic",
    "HBAR/USDT": "hedera-hashgraph",
    "XLM/USDT": "stellar",
    "AAVE/USDT": "aave",
    "MKR/USDT": "maker",
    "GRT/USDT": "the-graph",
    "SAND/USDT": "the-sandbox",
    "EOS/USDT": "eos",
    "CHZ/USDT": "chiliz",
}

# Correctif fondamental (découvert en validant les "Améliorations 1-9") :
# exiger RSI en zone extrême EXACTEMENT sur la bougie du croisement EMA9/21
# ne s'est JAMAIS produit une seule fois en 2 ans sur 20 paires (vérifié
# empiriquement) — le RSI, plus rapide, sort typiquement de la zone extrême
# avant qu'un croisement EMA21, plus lent, ne se confirme. RSI_CROSS_WINDOW
# élargit la vérification aux N bougies précédant ET incluant le croisement
# (jamais après : uniquement des données déjà connues au moment du signal,
# pour rester backtestable sans triche ET reproductible en production).
# Testé sur 12 mois/20 paires : fenêtres 1/2/3/4 donnent toutes un win rate
# proche de 32-33% (le seuil RSI 40/60 est le vrai facteur limitant, pas la
# fenêtre), mais 1 a le meilleur couple win rate (33.5%) / drawdown max
# (90.4%, contre 99%+ pour 2/3/4) à volume de trades très significatif
# (1138/an sur 20 paires). Aucune fenêtre testée n'atteint 50% de réussite
# seule — c'est précisément le rôle des filtres qualité ("Améliorations 1-9").
RSI_CROSS_WINDOW = 1

# --- Filtres expérimentaux ("Améliorations 1-9") — chacun backtesté sur 12
# mois/20 paires (voir signals/backtest.py, docstring de simulate_trades) une
# fois le correctif RSI_CROSS_WINDOW en place (base : 1138 trades/an, 33.5%
# de réussite, ratio 1.97, drawdown 90.4%). Désactivé tant que le backtest ne
# démontre pas une amélioration réelle (voir résultats ci-dessous).

# Amélioration 1 (HTF, EMA50 4h) : 296 trades, 33.4% (flat), drawdown 47.7%
# (bien meilleur, mais ni le win rate ni le nombre de trades ne s'améliorent
# au sens strict demandé) -> ABANDONNÉ.
ENABLE_HTF_FILTER = False
HTF_INTERVAL = "4h"
HTF_EMA_PERIOD = 50

# Amélioration 2 (volume > SMA20) : 907 trades (-20%), 33.6% (quasi flat)
# -> ABANDONNÉ.
ENABLE_VOLUME_FILTER = False
VOLUME_SMA_PERIOD = 20

# Amélioration 3 (SL/TP dynamiques ATR14) : 1138 trades (identique), 35.6%
# (+2.1pt), ratio 2.03 (vs 1.97), drawdown 81.4% (vs 90.4%) -> amélioration
# sur tous les axes -> CONSERVÉ.
ENABLE_ATR_STOPS = True
ATR_STOP_MULTIPLIER = 1.5
ATR_TARGET_MULTIPLIER = 3.0

# Mission "grille d'excellence" (validée par backtest sur 24 mois/20 paires) :
# remplace la sortie SL/TP unique par une gestion Multi-TP avec sécurisation
# Break-Even. TP1 atteint -> ferme MULTI_TP_TP1_WEIGHT de la position et
# remonte le stop au prix d'entrée (le reste ne peut plus finir perdant).
# TP2/TP3 ferment le reste par tranches. Testé avec/sans filtre de tendance
# HTF EMA200 4h (retiré : coûtait 58% du volume de signaux pour un gain de
# win rate nul), avec/sans déclencheur Liquidity Sweep/Squeeze (retiré :
# coûtait 87% du volume), avec/sans confirmation Taker Ratio/Funding Rate
# (retirées : aucune amélioration, coûtaient 19-50% du volume).
# Résultat retenu : 1.66 signal/jour, win rate perçu (TP1 sécurisé) 61.1%,
# win rate strict (TP2/TP3 atteint) 19.1%, ratio réel 0.68 (vs 2.04 pour le
# SL/TP unique), drawdown 40.0% (vs 54.5%). Décision produit assumée :
# l'espérance brute par trade est plus faible qu'avec le SL/TP unique
# (+0.026 à +0.039 vs +0.103 en unités de risque), mais le win rate perçu et
# le drawdown réduit sont jugés prioritaires pour la rétention abonnés.
#
# GÉOMÉTRIE RÉVISÉE LE 01/08/2026 (variante "G6", voir
# backtest_geometry_walkforward.py et DIAGNOSTIC_SIGNAUX_2026-08-01.md).
# L'ancienne géométrie (SL 1.5 / TP1 1.0 avec 50% du volume) était
# structurellement déséquilibrée : on risquait 1.5xATR pour ne sécuriser que
# 1.0xATR sur la MOITIÉ de la position. D'où un ratio gain/perte de 0.67 --
# les gagnants rapportaient moins que ce que coûtaient les perdants. Avec
# 60% de réussite : 60 x 0.67 = 40.2 contre 40 x 1.0 = 40.0, soit à
# l'équilibre au cheveu près... et négatif dès que le taux de réussite perd
# 1.5 point. C'est exactement ce qui s'est produit : l'espérance mesurée est
# passée de +0.065% à -0.029% par trade entre les deux semestres.
#
# Trois corrections combinées : stop resserré (1.2), TP1 repoussé au-delà du
# risque pris (1.3 > 1.2), et poids déplacé du TP1 vers le runner TP3
# (0.5/0.3/0.2 -> 0.3/0.3/0.4) pour laisser courir les gagnants.
#
# Validé en walk-forward sur DEUX semestres indépendants (critère qui a fait
# rejeter le moteur Squeeze et l'assouplissement RSI seul) :
#   semestre 1 : +0.128%/trade  (ancienne géométrie : +0.065%)
#   semestre 2 : +0.031%/trade  (ancienne géométrie : -0.029%, négative)
#   ratio gain/perte 1.10 (contre 0.67), drawdown 41% (contre 45%)
# Meilleure que l'ancienne sur TOUS les axes, drawdown compris, à volume de
# signaux inchangé (~2.6/jour).
#
# ⚠️ Effet d'affichage à connaître : le win rate PERÇU baisse (49% contre
# 60%). C'est attendu et sain -- TP1 plus loin est touché moins souvent,
# mais rapporte assez pour que l'ensemble devienne rentable. Ne pas
# réinterpréter cette baisse comme une régression (voir DISPLAY_WINRATE,
# laissé à false).
ENABLE_MULTI_TP_EXITS = True
MULTI_TP_SL_MULTIPLIER = 1.2    # resserré (était 1.5) : réduit la taille des perdants
MULTI_TP_TP1_MULTIPLIER = 1.3   # au-DELÀ du risque pris (1.2) -- c'était le défaut structurel
MULTI_TP_TP2_MULTIPLIER = 3.5   # objectif principal, ratio réel 3.5/1.2 = 1:2.9
MULTI_TP_TP3_MULTIPLIER = 6.0   # runner, ratio réel 6.0/1.2 = 1:5.0
MULTI_TP_TP1_WEIGHT = 0.3       # moins de volume sorti tôt...
MULTI_TP_TP2_WEIGHT = 0.3
MULTI_TP_TP3_WEIGHT = 0.4       # ...pour en laisser davantage courir jusqu'au runner

# Verrou de portefeuille (validé par backtest événementiel 24 mois + walk-
# forward 12/12 mois sur l'univers 28 paires, voir PAIRS ci-dessus) : jamais
# plus de MAX_ACTIVE_TRADES positions "à risque" (avant TP1) simultanément.
# Un trade qui atteint TP1 (passage au break-even) libère immédiatement son
# slot -- il ne peut plus finir perdant, donc ne compte plus comme "à risque".
# Résultat retenu (fenêtre de test la plus récente, 12 derniers mois,
# décision prise sur cette fenêtre plutôt que sur la période complète pour
# rester honnête sur la performance future probable) : ~2.0 signaux/jour,
# win rate TP1 61.6%, espérance +0.015 (positive), drawdown réaliste (risque
# fixe 2%/trade) 48.9% -- AU-DESSUS de la cible initiale de 35-40%, décision
# produit assumée d'accepter ce drawdown plus élevé contre le gain de
# fréquence (validée explicitement, voir aussi ENABLE_MULTI_TP_EXITS
# ci-dessus pour le même type d'arbitrage qualité/rétention).
ENABLE_PORTFOLIO_LOCK = True
MAX_ACTIVE_TRADES = 5

# Fenêtre de rattrapage (audit du 01/08/2026, correctif de perte de signaux).
# Constat : detect_signal() n'examinait que la DERNIÈRE bougie close, alors
# que le cron GitHub Actions ne se déclenche en pratique qu'environ 12 fois
# par jour au lieu de 24 (déclenchements planifiés retardés ou purement
# sautés -- mesuré sur l'historique réel des exécutions : 02:15, 03:42,
# 06:37, 09:12...). Chaque bougie jamais évaluée emportait définitivement
# ses croisements : sur 7 jours, ~10 signaux étaient attendus par la
# stratégie et 0 avaient réellement été émis.
# Le générateur balaie donc désormais les N dernières bougies closes à
# chaque cycle (voir strategy.detect_signals_with_catchup) : un cycle manqué
# est rattrapé au suivant. 6 bougies horaires = 6h de tolérance, largement
# au-delà du pire écart observé entre deux exécutions (~3h).
SIGNAL_CATCHUP_CANDLES = 6

# Garde-fou d'honnêteté du rattrapage : un signal détecté sur une bougie
# passée n'est diffusé que s'il reste réellement prenable au prix actuel
# (stop pas déjà touché, TP1 pas déjà atteint, et pas plus de cette fraction
# du chemin vers TP1 déjà parcourue). Sans lui, on annoncerait une entrée à
# un prix que le marché a déjà quitté -- malhonnête pour l'abonné, et
# faussement flatteur pour les statistiques publiées.
SIGNAL_MAX_DRIFT_TO_TP1 = 0.35

# Amélioration 5 (MACD 12/26/9) : voir résultat backtest ci-dessous une fois testé.
ENABLE_MACD_FILTER = False

# Amélioration 6 (heures creuses/week-end) : voir résultat backtest ci-dessous.
ENABLE_TRADING_HOURS_FILTER = False
QUIET_HOURS_START_UTC = 22  # inclus
QUIET_HOURS_END_UTC = 8     # exclu
# "Volatilité anormalement élevée" = ATR courant > ce multiplicateur x sa
# moyenne mobile sur ATR_ANOMALY_LOOKBACK bougies (même logique que le pic
# d'ATR des Alertes Momentum, voir momentum.py).
ATR_ANOMALY_MULTIPLIER = 1.5
ATR_ANOMALY_LOOKBACK = 24

# Amélioration 7 (signaux de continuation) : voir résultat backtest ci-dessous.
ENABLE_CONTINUATION_SIGNALS = False
CONTINUATION_WINDOW_HOURS = 48

# Amélioration 8 (corrélation BTC) : voir résultat backtest ci-dessous.
ENABLE_BTC_CRASH_FILTER = False
BTC_CRASH_DROP_PCT = 0.03
BTC_CRASH_WINDOW_MS = 2 * 60 * 60 * 1000
BTC_CRASH_SUSPEND_MS = 4 * 60 * 60 * 1000

# Piste 3 (régime de marché, ADX14) : testé sur 12 mois/20 paires. En période
# de tendance forte (ADX > seuil), ne garder que les signaux dans le sens de
# la tendance (+DI/-DI) élimine les signaux à contre-tendance les plus
# fragiles. Résultat : 1138->654 trades (-43%), win rate 35.6%->38.5%,
# ratio 2.03->2.05, drawdown 81.4%->54.5% (espérance/trade x2.2) -> CONSERVÉ.
ENABLE_ADX_REGIME_FILTER = True
ADX_TREND_THRESHOLD = 25

# Second moteur "⚡ Squeeze Volatilité 15M" (voir squeeze_engine.py),
# indépendant du moteur "🎯 Haute Confiance" ci-dessus -- tourne en
# parallèle sur le même cycle horaire pour augmenter la fréquence de
# signaux.
#
# DÉSACTIVÉ DÉFINITIVEMENT (30/07) après backtest combiné réel (12 mois,
# 40 paires, voir backtest_squeeze.py) : le seuil de compression (percentile
# 20 sur 24h glissantes de largeur de bande) s'est avéré bien trop permissif
# -- 13 662 trades/an (37.4/jour, cible 2-3), soit une compression détectée
# en pratique presque en continu plutôt que sur de vraies raretés. Plus
# grave que la fréquence : l'espérance par trade est NÉGATIVE (58.0% de
# réussite x ratio gain/perte 0.66 - 42.0% x 1 ≈ -3.7% par trade), ce que la
# haute fréquence amplifie en un drawdown de 98.7% (quasi-effondrement de
# l'équité simulée), très loin de la cible <45%. Pas un problème de réglage
# de fréquence : un edge qui perd de l'argent en moyenne perd plus vite avec
# plus de trades, il ne devient jamais rentable en resserrant juste le
# seuil. Code conservé (main.py l'importe) pour une itération future
# éventuelle sur la logique de détection elle-même, mais inactif en
# production tant qu'aucun nouveau backtest ne démontre une espérance
# positive. L'univers à 40 paires ci-dessus (config.PAIRS) reste actif :
# il profite déjà au moteur Haute Confiance seul (2.28 signaux/jour, win
# rate TP1 60.9%, indépendant de ce flag).
ENABLE_SQUEEZE_ENGINE = False
SQUEEZE_BB_PERIOD = 20
SQUEEZE_BB_STD = 2
SQUEEZE_LOOKBACK = 96            # 24h de bougies 15 min
SQUEEZE_PERCENTILE = 0.20        # largeur de bande dans les 20% les plus bas = compression
SQUEEZE_VOLUME_SMA_PERIOD = 20
SQUEEZE_SL_MULTIPLIER = 1.5
SQUEEZE_TP1_MULTIPLIER = 1.0
SQUEEZE_TP2_MULTIPLIER = 2.0
SQUEEZE_TP3_MULTIPLIER = 3.0
SQUEEZE_TP1_WEIGHT = 0.5
SQUEEZE_TP2_WEIGHT = 0.3
SQUEEZE_TP3_WEIGHT = 0.2
SQUEEZE_KLINES_LOOKBACK = 250     # bougies 15 min récupérées par cycle (~62h)

# --- Filtres structurels du moteur Squeeze (exploration du 31/07, voir
# SQUEEZE_EXPLORATION_2026-07-31.md) : s'ajoutent à la détection de base
# (compression -> cassure -> volume) pour tenter de retirer les faux départs
# responsables de l'espérance négative constatée. Valeurs ci-dessous
# "neutres" = comportement historique strictement inchangé. Chaque filtre est
# implémenté À L'IDENTIQUE dans squeeze_engine.detect_squeeze_signal (live) et
# dans backtest_squeeze._squeeze_entry_sides (simulation) -- les deux doivent
# rester synchronisés, sinon ce qui est validé n'est pas ce qui tourne.
SQUEEZE_REQUIRE_CONFIRMATION = False  # exige que la bougie SUIVANT la cassure clôture aussi hors bande (entrée décalée d'une bougie)
SQUEEZE_MIN_BREAKOUT_ATR = 0.0        # dépassement minimal de la bande à la clôture, en fraction d'ATR (0 = aucun)
SQUEEZE_VOLUME_MULTIPLIER = 1.0       # volume de la cassure > ce multiple de sa SMA (1.0 = filtre d'origine)
SQUEEZE_ADX_FILTER_MODE = "off"       # "off" | "hc" (rejette les contre-tendances quand ADX>seuil) | "strict" (exige ADX>seuil ET alignement)
SQUEEZE_ADX_THRESHOLD = 25
SQUEEZE_HTF_EMA_PERIOD = 0            # 0 = pas de filtre de tendance ; sinon EMA sur les clôtures 15m (200 ≈ EMA50 en 1h, 800 ≈ EMA50 en 4h)

# Bloc 11.3 : si l'ATR (volatilité) dépasse cette fraction du prix, aucun
# signal n'est émis pour la paire ce cycle (marché trop erratique pour que
# des niveaux de stop/target fixés à l'avance restent pertinents), et un
# message est publié sur le canal public via volatility_suspensions.
VOLATILITY_SUSPENSION_ATR_PCT = 0.05

# --- Paramètres de la stratégie (valeurs par défaut, ajustables par le backtest) ---
EMA_FAST_PERIOD = 9
EMA_SLOW_PERIOD = 21
RSI_PERIOD = 14
RSI_BUY_THRESHOLD = 40   # signal ACHAT si RSI < ce seuil
RSI_SELL_THRESHOLD = 60  # signal VENTE si RSI > ce seuil
BOLLINGER_PERIOD = 20
BOLLINGER_STD = 2

STOP_LOSS_PCT = 0.02      # -2 %
TAKE_PROFIT_PCT = 0.04    # +4 %

# --- Exécution (GitHub Actions, une passe par heure) ---
# Nombre de points minimum requis dans l'historique récupéré avant de
# pouvoir calculer des indicateurs fiables (EMA21 + marge).
MIN_HISTORY_POINTS = 30

# --- Graphiques (joints aux notifications Telegram/Discord) ---
# Bucket Supabase Storage à créer une fois manuellement (Dashboard -> Storage
# -> New bucket -> "public"). Voir README.
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "signal-charts")
CHART_LOOKBACK_POINTS = 60  # nombre de points de prix affichés sur le graphique
CHART_TMP_DIR = os.path.join(os.path.dirname(__file__), "data", "charts_tmp")

# --- Backtest ---
# Audit#4 : porté de 180 (~6 mois) à 730 (~24 mois), seuil de corrélation
# aussi relevé à 70%/2h (voir backtest.py). Résultat final sur 24 mois : 10
# trades indépendants (contre 3 sur 6 mois) — en progrès, mais toujours sous
# MIN_SIGNIFICANT_TRADES (15). Le nombre BRUT de trades avant filtrage n'est
# déjà que d'environ 16-20/an sur ces 20 paires, et la majorité sont corrélés
# entre eux (mouvements de marché larges) : la stratégie EMA/RSI par défaut
# est intrinsèquement peu fréquente sur cet univers de paires. Ce n'est pas
# corrigible en repoussant encore la fenêtre (Binance ne propose de toute
# façon pas 24 mois d'historique pour certaines paires récentes comme
# SOL/ARB/OP) — le code le signale déjà honnêtement (voir MIN_SIGNIFICANT_TRADES
# ci-dessous et le WARNING loggé quand l'échantillon est insuffisant) plutôt
# que d'afficher un taux de réussite trompeur. 730 est retenu comme valeur
# finale.
BACKTEST_DAYS = 730
# Nombre de jours max pendant lesquels on suit un trade simulé avant de
# le clôturer au marché si ni le SL ni le TP n'ont été touchés.
BACKTEST_TRADE_TIMEOUT_DAYS = 10
BACKTEST_TARGET_WIN_RATE = 0.60
