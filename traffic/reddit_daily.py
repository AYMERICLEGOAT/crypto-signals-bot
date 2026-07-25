"""
Point d'entrée pour la publication Reddit (GitHub Actions, voir
.github/workflows/reddit.yml). Isolé de promo_main.py pour ne déclencher QUE
Reddit depuis ce workflow (pas Twitter/Discord). Le workflow tourne tous les
jours, mais reddit_publisher.is_due() applique déjà l'espacement réel
(REDDIT_MIN_INTERVAL_DAYS, voir config.py) — pas besoin d'un cron exotique.
"""

import logging

import supabase_client
from reddit_publisher import publish_to_reddit

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def main():
    signal = supabase_client.get_latest_signal()
    if not signal:
        logger.info("Aucun signal en base : rien à publier sur Reddit aujourd'hui (pas de résumé macro pour ce canal).")
        return

    logger.info("Signal considéré: #%s %s %s", signal["id"], signal["pair"], signal["type"])
    published = publish_to_reddit(signal)
    logger.info("Reddit: %s", "publié" if published else "pas de publication cette fois")


if __name__ == "__main__":
    main()
