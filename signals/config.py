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

# --- CoinGecko ---
COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
# Limite d'appels/minute à respecter pour rester sur le plan gratuit sans clé API.
COINGECKO_MAX_CALLS_PER_MINUTE = 10

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
    "TRX/USDT": "tron",
    "MATIC/USDT": "matic-network",
    "LTC/USDT": "litecoin",
    "SHIB/USDT": "shiba-inu",
    "UNI/USDT": "uniswap",
    "ATOM/USDT": "cosmos",
    "NEAR/USDT": "near",
    "APT/USDT": "aptos",
    "ARB/USDT": "arbitrum",
    "OP/USDT": "optimism",
}

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
BACKTEST_DAYS = 180  # ~6 mois
# Nombre de jours max pendant lesquels on suit un trade simulé avant de
# le clôturer au marché si ni le SL ni le TP n'ont été touchés.
BACKTEST_TRADE_TIMEOUT_DAYS = 10
BACKTEST_TARGET_WIN_RATE = 0.60
