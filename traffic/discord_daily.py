"""
Point d'entrée pour la publication Discord quotidienne (GitHub Actions,
voir .github/workflows/discord.yml).

Discord est le seul canal d'acquisition automatisé qui reste. Twitter et
Reddit ont été retirés le 08/08/2026 : l'un rendait 403 à chaque tentative,
l'autre n'avait aucun identifiant configuré. Ils tournaient tous les jours
sans jamais rien publier.
"""

import logging

import supabase_client
from discord_publisher import publish_to_discord, publish_macro_summary

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def main():
    signal = supabase_client.get_latest_signal()
    if not signal:
        logger.info("Aucun signal en base : publication du résumé macro à la place.")
        published = publish_macro_summary()
        logger.info("Discord (résumé macro): %s", "publié" if published else "pas de publication cette fois")
        return

    logger.info("Signal considéré: #%s %s %s", signal["id"], signal["pair"], signal["type"])
    published = publish_to_discord(signal)
    logger.info("Discord: %s", "publié" if published else "pas de publication cette fois")


if __name__ == "__main__":
    main()
