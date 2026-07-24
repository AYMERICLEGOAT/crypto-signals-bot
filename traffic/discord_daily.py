"""
Point d'entrée pour la publication Discord quotidienne (GitHub Actions,
voir .github/workflows/discord.yml). Isolé de promo_main.py pour ne
déclencher QUE Discord depuis ce workflow (pas Twitter/Reddit).
"""

import logging

import supabase_client
from discord_publisher import publish_to_discord

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def main():
    signal = supabase_client.get_latest_signal()
    if not signal:
        logger.info("Aucun signal en base, rien à publier sur Discord.")
        return

    logger.info("Signal considéré: #%s %s %s", signal["id"], signal["pair"], signal["type"])
    published = publish_to_discord(signal)
    logger.info("Discord: %s", "publié" if published else "pas de publication cette fois")


if __name__ == "__main__":
    main()
