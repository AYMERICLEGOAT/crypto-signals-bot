"""
Publication Discord "one-shot" via l'API REST (pas besoin d'une connexion
gateway persistante) — utilisé par l'orchestrateur quotidien
(promo_main.py). Pour la commande à la demande `!signal`, voir
discord_bot.py (processus séparé et persistant, optionnel).
"""

import logging
from datetime import datetime, timezone

import requests

from config import DISCORD_BOT_TOKEN, DISCORD_CHANNEL_ID
from content_templates import format_discord_embed
import supabase_client

logger = logging.getLogger(__name__)

DISCORD_API_BASE = "https://discord.com/api/v10"


def is_due():
    """Un message par jour suffit : on vérifie qu'aucun signal n'a déjà été posté aujourd'hui."""
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    posted_today = supabase_client.count_posts_since("discord", start_of_day)
    if posted_today >= 1:
        logger.info("Discord: déjà publié aujourd'hui, on saute.")
        return False
    return True


def publish_to_discord(signal):
    """Envoie le signal du jour dans le canal Discord configuré. Retourne True si publié."""
    if not DISCORD_BOT_TOKEN or not DISCORD_CHANNEL_ID:
        raise RuntimeError("DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID manquants dans .env")

    if not is_due():
        return False

    if signal["id"] in supabase_client.get_posted_signal_ids("discord"):
        logger.info("Discord: signal #%s déjà publié, on saute.", signal["id"])
        return False

    payload = format_discord_embed(signal)
    resp = requests.post(
        f"{DISCORD_API_BASE}/channels/{DISCORD_CHANNEL_ID}/messages",
        headers={"Authorization": f"Bot {DISCORD_BOT_TOKEN}", "Content-Type": "application/json"},
        json=payload,
        timeout=15,
    )
    if not resp.ok:
        logger.error("Discord: échec de l'envoi (HTTP %s): %s", resp.status_code, resp.text)
        return False

    supabase_client.record_posted("discord", signal["id"])
    logger.info("Discord: message publié pour le signal #%s.", signal["id"])
    return True
