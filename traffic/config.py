"""
Configuration centrale du module d'acquisition de trafic.
"""

import os
from dotenv import load_dotenv

load_dotenv()

# --- Supabase (même projet que les modules précédents) ---
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# --- Liens promotionnels ---
TELEGRAM_CHANNEL_URL = os.getenv("TELEGRAM_CHANNEL_URL", "https://t.me/votre_canal_public")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "ProVIPSignals_bot").lstrip("@")

# --- Twitter (API v2) ---
TWITTER_CONSUMER_KEY = os.getenv("TWITTER_CONSUMER_KEY", "")
TWITTER_CONSUMER_SECRET = os.getenv("TWITTER_CONSUMER_SECRET", "")
TWITTER_ACCESS_TOKEN = os.getenv("TWITTER_ACCESS_TOKEN", "")
TWITTER_ACCESS_TOKEN_SECRET = os.getenv("TWITTER_ACCESS_TOKEN_SECRET", "")
# Plafonds volontairement configurables : le tier gratuit de l'API Twitter a
# changé plusieurs fois de limite (100, 500, 1500 posts/mois selon les
# périodes) — ne jamais coder une limite en dur, se fier à ce que le compte
# développeur affiche réellement au moment de la configuration.
TWITTER_MAX_PER_DAY = int(os.getenv("TWITTER_MAX_PER_DAY", "3"))
TWITTER_MAX_PER_MONTH = int(os.getenv("TWITTER_MAX_PER_MONTH", "100"))
TWITTER_MIN_DELAY_SECONDS = int(os.getenv("TWITTER_MIN_DELAY_SECONDS", "120"))
TWITTER_MAX_DELAY_SECONDS = int(os.getenv("TWITTER_MAX_DELAY_SECONDS", "1800"))

# --- Reddit (PRAW, compte "script app" unique) ---
REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
REDDIT_USERNAME = os.getenv("REDDIT_USERNAME", "")
REDDIT_PASSWORD = os.getenv("REDDIT_PASSWORD", "")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "signal-promo-bot/1.0")
# ⚠️ Vérifie les règles d'auto-promotion de CHAQUE subreddit avant de l'ajouter
# ici — beaucoup interdisent explicitement les liens vers des bots/canaux
# payants ou exigent une autorisation préalable des modérateurs. Voir README.
REDDIT_SUBREDDITS = [s.strip() for s in os.getenv("REDDIT_SUBREDDITS", "CryptoCurrency,CryptoMarkets,cryptotrading").split(",") if s.strip()]
REDDIT_MIN_INTERVAL_DAYS = int(os.getenv("REDDIT_MIN_INTERVAL_DAYS", "2"))

# --- Discord (application officielle, Developer Portal) ---
DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
DISCORD_CHANNEL_ID = os.getenv("DISCORD_CHANNEL_ID", "")
DISCORD_COMMAND_PREFIX = os.getenv("DISCORD_COMMAND_PREFIX", "!")

# --- Logs ---
LOG_FILE_PATH = os.path.join(os.path.dirname(__file__), "data", "promo.log")
