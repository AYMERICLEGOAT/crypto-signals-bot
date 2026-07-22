"""
Configuration centrale du générateur de contenu SEO.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- Supabase (même projet que les modules signals/ et bot/) ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# --- GitHub (dépôt du site statique, connecté à Cloudflare Pages) ---
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO = os.getenv("GITHUB_REPO", "")  # format "utilisateur/nom-du-repo"
GITHUB_BRANCH = os.getenv("GITHUB_BRANCH", "main")
# Sous-dossier du dépôt où vivent les fichiers du site (vide = racine du dépôt).
SITE_SUBDIR = os.getenv("SITE_SUBDIR", "").strip("/")

# --- Site ---
SITE_BASE_URL = os.getenv("SITE_BASE_URL", "https://votre-site.pages.dev").rstrip("/")
SITE_NAME = os.getenv("SITE_NAME", "Signaux Crypto Gratuits")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "ProVIPSignals_bot").lstrip("@")

NUM_SIGNALS_TO_DISPLAY = 5

# --- CoinGecko (pour évaluer les résultats des signaux passés) ---
COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3"
COINGECKO_MAX_CALLS_PER_MINUTE = 10

# Mapping paire -> identifiant CoinGecko (mêmes 20 paires que le module signals/).
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

# --- Évaluation des performances passées ---
# Au-delà de ce délai sans avoir touché le stop loss ni le take profit, un
# signal est considéré expiré et compté comme une perte (hypothèse
# conservatrice, cohérente avec le backtest du module signals/).
EVAL_TIMEOUT_DAYS = 10
# Fenêtre de signaux considérés pour les statistiques de performance affichées.
PERFORMANCE_WINDOW_SIZE = 200

# --- Fichiers locaux ---
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
PAGES_MANIFEST_PATH = os.path.join(DATA_DIR, "pages_manifest.json")

# --- Sortie locale (avant publication sur GitHub) ---
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
