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

# --- Discord (application officielle, Developer Portal) ---
DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")
DISCORD_CHANNEL_ID = os.getenv("DISCORD_CHANNEL_ID", "")
DISCORD_COMMAND_PREFIX = os.getenv("DISCORD_COMMAND_PREFIX", "!")

# --- Logs ---
LOG_FILE_PATH = os.path.join(os.path.dirname(__file__), "data", "promo.log")
