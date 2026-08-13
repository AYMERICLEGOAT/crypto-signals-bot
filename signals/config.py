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

# Canal public. Pas un secret non plus : déjà en clair dans wrangler.toml.
# Utilisé par watchlist.py, qui publie la liste quotidienne directement depuis
# le module Python plutôt que de passer par une table et le Worker — la liste
# est calculée à partir de données que seul ce module possède (bougies
# journalières des 40 paires, classement du carry), et la faire transiter par
# la base demanderait une table de plus pour rien.
TELEGRAM_CHANNEL_ID = os.getenv("TELEGRAM_CHANNEL_ID", "-1004450068761")

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
#
# RELEVÉ À 35 LE 07/08/2026, ET LE CHIFFRE DE 5 ÉTAIT DEVENU DESTRUCTEUR.
#
# Tout ce qui précède décrit l'ANCIEN moteur horaire EMA/RSI, dont les signaux
# se résolvaient en quelques heures : une position libérait vite son slot, et
# cinq places suffisaient à faire passer ~2 signaux par jour. Les moteurs
# actuels sortent sur une DURÉE — 7 jours pour la force relative, 3 pour le
# momentum 4 h — et une position occupe donc son slot du premier au dernier
# jour. La contrainte n'a plus du tout le même effet, et elle n'a jamais été
# remesurée après le changement de moteur.
#
# Mesuré sur 3 200 jours réels, force relative top 12 tenue 7 jours, un signal
# refusé étant PERDU et non mis en file d'attente, comme en production :
#
#     plafond 5   : 0,30 signal/jour, 91,7 % des signaux PERDUS   <-- déployé
#     plafond 10  : 0,60 signal/jour, 71,2 % perdus
#     plafond 20  : 0,94 signal/jour,  1,2 % perdus
#     plafond 35  : 0,95 signal/jour,  0,0 % perdu
#     sans plafond: 0,95 signal/jour
#
# La stratégie validée tient 14 positions simultanées en médiane et 22 au pic.
# À cinq places, neuf signaux sur dix n'atteignaient jamais l'abonné — sans
# aucune trace ailleurs qu'une ligne de log de comptage. C'est exactement le
# même défaut que le comptage des carrys corrigé le même jour : un garde-fou
# dimensionné pour un système qui n'existe plus, qui étrangle silencieusement
# le produit.
#
# Un piège à ne pas suivre : à plafond 5, l'espérance PAR SIGNAL monte à
# +3,734 % contre +2,831 % sans plafond. Ce n'est pas un avantage, c'est un
# effet de sélection — seuls passent les signaux qui tombent quand une place
# vient de se libérer. Rapporté au jour, le plafond serré rend 1,12 % contre
# 2,69 %, soit deux fois et demie moins.
#
# 35 = QUOTA_SIGNAUX_MAX x RS_HOLD_DAYS : le nombre exact de positions qu'un
# quota de 5 signaux par jour tenus 7 jours peut atteindre, et pas une de plus.
# Ces deux constantes sont définies plus bas dans ce fichier ; la cohérence des
# trois est vérifiée à la fin (voir « Cohérence du dimensionnement »), pour
# qu'un changement de quota ou de durée ne puisse pas rétablir l'étranglement
# sans que rien ne le dise.
#
# Le contrôle du VOLUME est désormais l'affaire de l'arbitre (voir
# signal_arbiter.py) ; ce verrou-ci ne garde que son rôle de frein d'urgence.
# Le risque reste celui qui a été mesuré et qui est annoncé publiquement :
# le portefeuille de référence a connu -62,9 % de repli maximal.
ENABLE_PORTFOLIO_LOCK = True
MAX_ACTIVE_TRADES = 35

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

# --- Moteur Haute Confiance (croisement EMA confirmé par un RSI BAS) ---
# DÉSACTIVÉ le 03/08/2026, remplacé par le moteur Force Relative.
#
# Ce moteur achetait sur RSI < RSI_BUY_THRESHOLD, c'est-à-dire le quintile RSI
# le plus bas. Mesuré sur 6 ans et 18 paires non contaminées par le biais du
# survivant, c'est la jambe PERDANTE : de -24,9 % à +16,9 % par an selon les
# réglages, majoritairement négative, contre +45,6 % à +104,4 % pour le sens
# inverse. L'écart est de +69,6 points par an et il est positif sur 18
# combinaisons de paramètres sur 18 (backtest_rsi_attaque, attaque 3).
#
# Réserve à conserver telle quelle, parce qu'elle est réelle : ce moteur opère
# en 1 heure, pas en journalier transversal. Que le sens « RSI bas » perde à
# l'horizon journalier ne PROUVE pas formellement qu'il perde au sien. Ce qui
# est établi, en revanche, c'est qu'aucune des ~35 variantes de cette famille
# n'a jamais passé le protocole de validation, et que le test des unités de
# temps montrait une dégradation du 1h vers le 4h — signature d'une absence de
# pouvoir prédictif. Continuer à diffuser à des abonnés payants une direction
# que nos propres mesures désignent comme perdante n'était plus défendable.
#
# Les constantes ci-dessous sont conservées : elles servent encore aux backtests
# de comparaison et au moteur Squeeze.
ENABLE_HIGH_CONFIDENCE_ENGINE = False

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

# --- Moteur Force Relative (voir relative_strength.py) ---
# Premier moteur du projet reposant sur un avantage effectivement mesuré et
# non sur une règle technique supposée. Chaque valeur ci-dessous provient d'un
# backtest nommé ; aucune n'a été choisie parce qu'elle embellissait la courbe.
# Ne modifier aucune de ces constantes sans relancer le module correspondant.
#
# Activé le 03/08/2026 sur décision explicite de l'admin, après lui avoir
# présenté les mesures ET leurs contreparties : changement de nature du produit
# (signaux journaliers tenus 7 jours avec stops larges, au lieu d'horaires),
# aucun historique en direct, et surtout 41 % du temps sans aucun signal — la
# plus longue fermeture ayant duré 381 jours. Ces contreparties sont désormais
# assumées et écrites noir sur blanc côté abonné (site, CGV, /start).
ENABLE_RELATIVE_STRENGTH_ENGINE = True

# Le moteur travaille en JOURNALIER, pas en intrajournalier. C'est essentiel :
# à 0,10 % de frais aller-retour, seuls des mouvements de plusieurs jours
# laissent un avantage net. Les moteurs horaires payaient 5 à 10 fois leur edge
# en frais (voir backtest_timeframes.py).
RS_RSI_PERIOD = 21          # backtest_rsi_long : 18/18 combinaisons positives
RS_HOLD_DAYS = 7            # sortie TEMPORELLE, c'est ce qui a été validé

# Nombre de positions : le curseur quantité/qualité, mesuré sur l'univers de
# PRODUCTION à 40 paires (backtest_frontiere_production). Les mesures d'origine
# portaient sur 18 paires, où « top 5 » sélectionnait 28 % de l'univers ; sur
# 40 paires le même 5 n'en sélectionne plus que 12,5 %, ce qui n'est ni la même
# sélectivité ni la même quantité. La frontière complète, filtre actif :
#
#     top  5 / 7j :  3,5 signaux/sem | 49,7 % | +3,33 % | 4/5 années positives
#     top 10 / 7j :  6,9 signaux/sem | 47,6 % | +3,38 % | 4/5
#     top 12 / 7j :  8,0 signaux/sem | 47,7 % | +3,22 % | 4/5   <- retenu
#     top 15 / 7j :  9,5 signaux/sem | 47,7 % | +2,76 % | 4/5
#     top 20 / 5j : 15,3 signaux/sem | 47,4 % | +1,74 % | 4/5
#
# Toutes restent à 4/5 années positives : la qualité se dégrade progressivement,
# pas brutalement. Passer de 5 à 12 multiplie les signaux par 2,3 pour 0,11
# point d'espérance — le meilleur compromis quand la quantité compte autant que
# la qualité. Au-delà de 15 la dégradation s'accélère nettement.
RS_TOP_N = 12
RS_TREND_MA_PERIOD = 200    # filtre absolu, Antonacci (2014) — règle extérieure au projet
RS_MIN_RANKED_PAIRS = 15    # en dessous, le classement transversal n'a pas de sens

# Cadence. Le backtest évalue le classement UNE fois par jour sur des clôtures
# journalières. Le faire tourner à chaque cycle diffuserait une stratégie
# différente de celle qui a été validée : le classement bouge en cours de
# journée et on émettrait sur du bruit intrajournalier.
#
# Heure la plus tôt à laquelle le passage quotidien peut avoir lieu, soit une
# heure après la clôture UTC — le temps que la bougie de la veille soit close et
# disponible. Ce n'est PAS une fenêtre : le premier passage à partir de cette
# heure déclenche le moteur, quel que soit le retard du cron, et les suivants
# sont ignorés grâce au marqueur en base (storage.daily_job_already_ran_today).
# Une fenêtre de 15 minutes avait été essayée d'abord ; les crons GitHub Actions
# étant retardés de 10 à 20 minutes de façon routinière, elle faisait passer des
# journées entières sans le moindre signal, sans rien signaler.
#
# CETTE HEURE COMMANDE TOUT LE CALENDRIER DU PRODUIT, pas seulement l'émission.
#
# Elle valait 1 h UTC, soit 3 h du matin à Paris. Tout en découlait :
#   - les signaux partaient en message privé vers 5 h 10 (relevé du 12 et du
#     13/08/2026, LINK, DOGE, MKR, SOL) ;
#   - les clôtures tombant exactement à hold_until, c'est-à-dire au même moment
#     du jour trois jours plus tard, le canal PUBLIC a publié des clôtures à
#     04 h 25, 04 h 50 et 04 h 30 — en pleines heures calmes, que ce chemin ne
#     consultait pas ;
#   - et l'abonné recevait la notification de sortie de sa position à 4 h 30.
#
# Aucun de ces trois symptômes n'était un défaut du code qui les produisait :
# c'était cette constante, trois niveaux plus haut.
#
# 8 h UTC = 10 h à Paris. Trois raisons, dans cet ordre :
#   1. L'audience est française. Un signal reçu à 10 h est lu ; un signal reçu à
#      5 h réveille ou se perd sous vingt autres notifications.
#   2. Les heures calmes du canal public finissent à 7 h UTC. Émettre à 8 h met
#      l'ouverture ET la clôture, trois jours plus tard, largement hors de la
#      fenêtre de silence — sans dépendre d'un report.
#   3. Les bougies de 4 heures se closent à 00, 04, 08, 12, 16 et 20 h UTC. Le
#      passage lit donc une bougie fraîchement close plutôt qu'une bougie de
#      milieu de période, ce qui rapproche l'exécution réelle de la mesure du
#      backtest au lieu de l'en éloigner.
#
# La force relative, elle, travaille sur des clôtures JOURNALIÈRES : décaler de
# 1 h à 8 h ne change pas la bougie qu'elle lit, seulement le moment où elle la
# lit. Sa stratégie est donc strictement inchangée.
RS_RUN_HOUR_UTC = 8

# --- Moteur Carry de Financement (voir carry_engine.py) ---
# Position neutre au marché : achat du spot, vente du perpétuel pour le même
# montant. Le rendement ne vient pas du prix mais du financement encaissé.
# C'est la SEULE famille du projet positive en marché baissier, et la seule
# dont la médiane par position est positive.
ENABLE_CARRY_ENGINE = True

# Univers : les perpétuels les plus échangés, et non les 40 paires du projet.
# C'est le levier de quantité le plus efficace du moteur — trois fois plus de
# candidats à sélectivité égale. Il n'a été débloqué que par le stop ci-dessous :
# sans lui, la pire position sur univers élargi atteignait -66,70 %.
# Le classement du volume est refait à chaque passage (endpoint public).
CARRY_UNIVERSE_SIZE = 120

# Univers ÉLARGI, utilisé seulement quand l'univers normal ne produit pas assez.
#
# Le principe est important : on élargit la RECHERCHE, on ne baisse jamais la
# barre. Un jour creux, chercher parmi 200 perpétuels au lieu de 120 fait
# apparaître des opportunités qui satisfont exactement les mêmes critères —
# c'est différent d'accepter des opportunités moins bonnes pour remplir le canal.
#
# Plafonné à 200 et pas au-delà : le volume s'effondre après. Au rang 200 un
# perpétuel traite 1,4 M$ par jour, au rang 300 seulement 0,6 M$. En dessous,
# un abonné ne peut pas exécuter, et un perpétuel peu profond est précisément
# celui où le financement s'inverse violemment.
CARRY_UNIVERSE_SIZE_ELARGI = 200

# En dessous de ce nombre de candidats retenus, le moteur relance sa recherche
# sur l'univers élargi. Mesuré le 06/08/2026 : sur 120 perpétuels, 2 paires
# dépassaient 5 %/an ; sur 200, six. La barre de qualité, elle, n'a pas bougé.
CARRY_MIN_CANDIDATS = 3

# 40 places tenues 21 jours ouvrent 40/21 position par jour en moyenne. Mesuré
# sous la forme livrée, univers élargi et stop actif (backtest_carry_stop) :
# 1,35 signal/jour, 82,7 % de positions gagnantes, +0,545 % net.
# EN MARCHÉ DÉFAVORABLE — le seul régime où ce moteur compte vraiment :
# 1,24 signal/jour à 76,1 % de gagnantes, contre 0,49 avant l'élargissement.
# Seule 2022 est négative, à -0,046 % par position : plate, pas perdante.
# Au-delà de 60 places la réussite tombe sous 79 % et à 73 % sur les années
# récentes ; 40 est le point où la quantité cesse de coûter de la qualité.
CARRY_MAX_POSITIONS = 40

# 21 jours est un SEUIL, pas un curseur. À 14 jours la pire position passe de
# -3,86 % à -30,18 % et le nombre d'années positives tombe de 7/7 à 5/7 : le
# financement n'a pas le temps de couvrir les frais et l'aléa domine. Ne pas
# raccourcir pour gagner en quantité sans relancer backtest_carry_production.
CARRY_HOLD_DAYS = 21

# Fenêtre de classement. Le financement passé prédit le futur (corrélation
# +0,687 à 7 jours, +0,620 à 14, +0,584 à 30) : une fenêtre égale à la durée de
# détention est le compromis mesuré entre réactivité et stabilité.
CARRY_LOOKBACK_DAYS = 21

# Plancher sur le financement d'entrée. Il était à 0,015 %/jour, ce qui ne
# laissait passer que 4 paires sur 37 le 04/08/2026 et étranglait la quantité.
# L'abaisser fait passer le régime défavorable de 0,72 à 0,82 signal/jour pour
# 86,5 % de gagnantes au lieu de 87,8 % : bon échange.
#
# 0,010 %/jour x 21 jours = 0,21 %, soit tout juste au-dessus des 0,20 % de
# frais. C'est le plancher ARITHMÉTIQUE en dessous duquel une position serait
# perdante d'avance — mais il est si serré que le moteur ne s'y fie pas :
# carry_engine écarte en plus toute position dont l'espérance ANNONCÉE ne serait
# pas franchement positive (voir CARRY_MIN_EXPECTED_PCT). Annoncer un gain
# attendu de +0,01 % serait exact et pourtant absurde.
CARRY_MIN_FUNDING_PCT_PER_DAY = 0.010

# Espérance annoncée minimale sur la durée de détention, frais déduits.
#
# Deux rôles. D'abord empêcher qu'un signal parte avec un gain attendu nul ou
# négatif — ce serait annoncer une perte à l'abonné. Ce garde-fou double
# volontairement le plancher ci-dessus : si quelqu'un modifie la durée ou les
# frais sans recalculer le plancher, c'est celui-ci qui rattrape l'erreur.
#
# Ensuite, et c'est ce qui a fait monter la valeur de 0,05 à 0,55 en deux
# étapes : ne publier que des positions REMARQUABLES. Un carry demande d'ouvrir
# deux positions sur deux produits et de surveiller une marge. Personne ne se
# dérange pour 2 %/an — et le retour de l'admin a été sans ambiguïté, deux fois
# de suite : « c'est pas ouf », « c'est bizarre voire nul ».
#
# 0,55 % sur 21 jours correspond à 10 %/an. En dessous, une position neutre au
# marché ne vaut pas le geste face à n'importe quel placement, et la publier
# dilue la perception de tout le canal. Mieux vaut un carry par semaine à
# 20 %/an que cinq à 3 %/an : le premier se retient, les cinq autres donnent
# l'impression d'un canal qui parle pour ne rien dire.
#
# Conséquence assumée : les jours où le financement est plat — comme le
# 06/08/2026, où 2 paires seulement dépassaient 5 %/an sur 119 — le moteur
# n'émet rien. C'est le comportement voulu.
CARRY_MIN_EXPECTED_PCT = 0.55

# Plafond : un financement extrême ne signale pas une bonne affaire mais une
# manie, et c'est exactement là que se logent les pertes rares et énormes. Sans
# ce plafond, sur univers élargi, la pire position mesurée atteignait -68 %.
CARRY_MAX_FUNDING_PCT_PER_DAY = 0.15

# Coût d'ouverture ET de fermeture des deux jambes (spot + perpétuel), à 0,10 %
# l'aller-retour par jambe. C'est ce qui est déduit du financement annoncé.
CARRY_ROUND_TRIP_COST_PCT = 0.20

# STOP SUR LE FINANCEMENT CUMULÉ, en pourcentage négatif. Dès qu'une position a
# COÛTÉ plus que ce seuil, les deux jambes sont fermées sans attendre le terme.
#
# Ce n'est pas un stop de prix — la position y est insensible. Le financement
# d'un perpétuel peut s'INVERSER lors d'un squeeze : ce sont alors les vendeurs
# qui paient, parfois pendant plusieurs jours. Rien n'arrêtait ça auparavant.
#
# Mesuré : la pire position passe de -66,70 % à -19,86 %, l'espérance MONTE de
# +0,656 % à +0,761 %, et seules 1,7 % des positions le déclenchent. Il ne coupe
# donc pas de gagnantes — contrairement au stop de prix des familles
# directionnelles, où plus il était serré, plus il coûtait cher.
#
# Le -19,86 % résiduel vient d'une journée unique à financement extrême : un
# stop vérifié quotidiennement ne peut pas l'anticiper, seulement en limiter la
# suite. C'est le risque résiduel assumé, et il doit être dit aux abonnés.
CARRY_STOP_FUNDING_PCT = -1.5

# Nombre maximal de NOUVELLES positions ouvertes par jour.
#
# Sans ce plafond, un démarrage à froid remplit les 40 places d'un seul coup :
# observé en production le 04/08/2026, 31 carrys détectés en une fois. C'est
# exactement la rafale que la forme échelonnée devait éviter, et pour un canal
# c'est pire que peu de signaux — l'abonné en reçoit trente le premier jour puis
# plus rien pendant trois semaines.
#
# Le régime permanent est de toute façon CARRY_MAX_POSITIONS / CARRY_HOLD_DAYS,
# soit environ 1,9 ouverture par jour. Le plafond à 3 laisse de quoi rattraper
# une journée manquée sans jamais produire de rafale.
CARRY_MAX_NEW_PER_DAY = 3

# Le moteur tourne une fois par jour, comme la force relative, et pour la même
# raison : le classement est calculé sur des versements journaliers agrégés.
CARRY_RUN_HOUR_UTC = 1

# --- Liste du jour (voir watchlist.py) ---
# Publiée une fois par jour sur le canal public, qu'il y ait des signaux ou non.
# C'est ce qui empêche le canal d'être muet pendant les 41 % du temps où la
# condition d'entrée est fermée, sans avoir à inventer des trades.
#
# 8 h UTC, soit 10 h en France : assez tôt pour que l'abonné l'ait avant sa
# journée, assez tard pour que la bougie journalière de la veille soit close
# et que les moteurs aient déjà tourné (ils passent à 1 h UTC).
ENABLE_DAILY_WATCHLIST = True
WATCHLIST_RUN_HOUR_UTC = 8

# --- Moteur Momentum 4 heures (voir momentum_4h.py) ---
#
# EN OBSERVATION. Positif 3 années sur 4 en marché défavorable, mais en
# décroissance monotone : +2,06 % en 2023, +1,28 % en 2024, +0,29 % en 2025,
# -0,53 % en 2026. Quatre ans ne permettent pas de trancher entre un avantage
# qui s'érode et un avantage qui n'a jamais existé. Il est donc livré bridé,
# étiqueté comme tel, et surveillé par edge_guard.
ENABLE_MOMENTUM_4H = True

# Ne travaille QUE quand le Bitcoin est SOUS sa moyenne 200 jours — l'exact
# inverse de la force relative. C'est sa seule raison d'être :
# combler le trou qu'elles laissent 41 % du temps.
M4H_RSI_PERIOD = 42          # 42 bougies de 4 h = 7 jours
M4H_HOLD_BOUGIES = 18        # 18 bougies = 3 jours, la durée mesurée
M4H_SL_ATR_MULT = 4.0
M4H_MIN_RANKED_PAIRS = 15

# Combien de paires le moteur retient en tête de classement.
#
# Mesuré sur 1 100 jours, en marché défavorable uniquement, garde 3 jours :
#
#     top 1  : 0,71 sig/j | +0,699 % | 3 années positives sur 4
#     top 2  : 1,25 sig/j | +0,805 % | 2/4
#     top 3  : 1,74 sig/j | +0,688 % | 3/4
#     top 5  : 2,61 sig/j | +0,576 % | 3/4
#     top 12 : 4,80 sig/j | +0,313 % | 3/4
#
# L'espérance décroît régulièrement quand on descend dans le classement, ce qui
# est exactement ce qu'on attend d'un momentum transversal : le signal est dans
# le RANG, pas dans le nombre. Deux places, donc — le meilleur compromis mesuré,
# et la même valeur que le plafond imposé par l'arbitre aux moteurs en
# observation, si bien que ce que le moteur propose est ce qui est publié.
#
# Réserve à garder en tête : à top 2 le nombre d'années positives tombe à 2 sur
# 4, contre 3 sur 4 ailleurs. Moins de signaux, donc plus de bruit d'une année à
# l'autre. C'est une raison de plus de traiter ce moteur comme en observation.
M4H_TOP_N = 2

# --- Arbitre de signaux (voir signal_arbiter.py) ---
#
# Un juge unique pour tous les moteurs. Sans lui, chaque moteur décide seul :
# un jour porteur tous les moteurs tirent ensemble et l'abonné reçoit dix
# signaux d'un coup, un jour creux aucune ne tire et le canal est muet.
#
# Le MAXIMUM est une vraie limite : au-delà, les moins bons candidats sont
# écartés, pas mis en file d'attente — un signal de momentum vieux d'un jour
# n'est plus le même signal.
#
# Le MINIMUM n'est PAS une limite, c'est un objectif journalisé. Rien n'est
# jamais ajouté pour l'atteindre : compléter avec les moins bons candidats du
# jour reviendrait à diffuser exactement ceux que la mesure dit perdants.
# --- Cassure de canal et expansion de volatilité (voir cassure_expansion.py) ---
#
# Les deux familles que le produit ANNONÇAIT sans les émettre. Mesurées seules,
# avec le filtre de tendance et une barre fixée avant de regarder les résultats
# (backtest_deux_familles.py) :
#
#   cassure de canal        815 signaux | 51,4 % gagnants | +5,689 % | p = 0,000
#   expansion de volatilité 210 signaux | 52,4 % gagnants | +5,640 % | p = 0,000
#
# Le témoin aléatoire de même densité rend +0,9 % : l'écart ne doit rien au
# hasard. Dix approches sur douze ont échoué exactement à cette étape.
ENABLE_CASSURE_ENGINE = True
ENABLE_EXPANSION_ENGINE = True

# 50 jours : la valeur mesurée. Plus court multiplierait les faux départs, plus
# long ne déclencherait presque jamais sur cet univers.
CASSURE_FENETRE_JOURS = 50

# Rapport ATR court / ATR long. Sous 1 pendant toute la compression, au-dessus
# le jour du réveil.
EXPANSION_ATR_COURT = 7
EXPANSION_ATR_LONG = 50
EXPANSION_COMPRESSION_JOURS = 20

# Plafonds par moteur et par jour. La mesure donne 0,32 et 0,09 signal par jour :
# ces bornes ne mordent qu'en cas d'anomalie — un jour où trente paires
# franchiraient leur plus haut ensemble est un jour de marché exceptionnel, pas
# trente occasions indépendantes.
CASSURE_MAX_PAR_JOUR = 3
EXPANSION_MAX_PAR_JOUR = 2

QUOTA_SIGNAUX_MIN = 2
QUOTA_SIGNAUX_MAX = 5

# Part maximale d'un moteur EN OBSERVATION dans une journée (voir
# signal_arbiter.MOTEURS_EN_OBSERVATION). Sans ce plafond, le moteur dont
# l'avantage est le moins établi prenait les cinq places — observé dès le
# premier passage réel. Deux sur cinq : présent, jamais majoritaire.
QUOTA_OBSERVATION_MAX = 2

# Géométrie mesurée par backtest_stop_impact sur 6 ans. Contre-intuitif mais
# net : plus le stop est serré, plus il coûte cher. À 1 x ATR l'espérance tombe
# à +2,05 % par trade contre +2,74 % à 4 x ATR, parce que le stop coupe des
# positions qui seraient revenues. Un objectif serré est pire encore : à
# 3 x ATR il détruit 87 % de l'avantage, les gains venant de rares très gros
# mouvements. Les objectifs ci-dessous ne déclenchent que 2 % des sorties : ils
# jalonnent la progression pour l'abonné, ils ne pilotent pas la clôture.
RS_SL_ATR_MULT = 4.0        # protection catastrophe : 5 % des sorties seulement
RS_TP1_ATR_MULT = 4.0
RS_TP2_ATR_MULT = 8.0
RS_TP3_ATR_MULT = 12.0

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


# ---------------------------------------------------------------------------
# Cohérence du dimensionnement
# ---------------------------------------------------------------------------
#
# Vérifié à l'import, parce que l'incohérence que ce bloc empêche ne se voit
# NULLE PART ailleurs : elle ne fait rien planter, ne remplit aucun log
# d'erreur, et se manifeste seulement par un canal plus silencieux que prévu.
# Elle a coûté 91,7 % des signaux de force relative jusqu'au 07/08/2026.
#
# La règle : le verrou de portefeuille ne doit JAMAIS être la contrainte qui
# limite le débit. C'est l'arbitre qui décide du volume (QUOTA_SIGNAUX_MAX par
# jour) ; le verrou n'est là que contre l'accident. Il faut donc qu'il puisse
# accueillir le pire cas légitime — le quota plein, tenu pendant la plus longue
# durée de détention d'un moteur directionnel.
_POSITIONS_NECESSAIRES = QUOTA_SIGNAUX_MAX * max(RS_HOLD_DAYS, M4H_HOLD_BOUGIES // 6)

if ENABLE_PORTFOLIO_LOCK and MAX_ACTIVE_TRADES < _POSITIONS_NECESSAIRES:
    raise ValueError(
        f"MAX_ACTIVE_TRADES = {MAX_ACTIVE_TRADES} étrangle le quota de signaux : "
        f"{QUOTA_SIGNAUX_MAX} signaux par jour tenus jusqu'à "
        f"{max(RS_HOLD_DAYS, M4H_HOLD_BOUGIES // 6)} jours demandent "
        f"{_POSITIONS_NECESSAIRES} positions simultanées. Le verrou refuserait "
        f"silencieusement les signaux excédentaires, sans autre trace qu'une ligne "
        f"de log de comptage. Relever MAX_ACTIVE_TRADES, ou baisser le quota en "
        f"connaissance de cause."
    )
