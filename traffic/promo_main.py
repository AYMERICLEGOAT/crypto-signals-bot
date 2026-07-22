"""
Orchestrateur du module d'acquisition de trafic.

Usage :
    python promo_main.py            # une passe : poste sur chaque plateforme si c'est son tour, puis quitte
    python promo_main.py --loop     # tourne en continu (utile pour étaler les tweets sur la journée
                                     # avec le délai aléatoire, plutôt qu'une seule fois via cron)
"""

import argparse
import logging
import os
import random
import time

from config import LOG_FILE_PATH
import supabase_client
from twitter_publisher import publish_to_twitter
from reddit_publisher import publish_to_reddit
from discord_publisher import publish_to_discord

# En mode --loop, on revérifie toutes les ~6h (avec un peu de gigue) : assez
# souvent pour laisser Twitter poster jusqu'à 3 fois dans la journée, sans
# spammer les vérifications inutilement (Reddit/Discord ont leurs propres
# délais minimum bien plus longs, gérés dans leurs modules respectifs).
LOOP_CHECK_INTERVAL_SECONDS = 6 * 60 * 60


def _setup_logging():
    os.makedirs(os.path.dirname(LOG_FILE_PATH), exist_ok=True)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.FileHandler(LOG_FILE_PATH, encoding="utf-8"), logging.StreamHandler()],
    )


def run_once():
    """Une passe : tente une publication sur chaque plateforme si c'est son tour."""
    logger = logging.getLogger(__name__)
    signal = supabase_client.get_latest_signal()
    if not signal:
        logger.info("Aucun signal en base, rien à publier.")
        return

    logger.info("Signal considéré: #%s %s %s", signal["id"], signal["pair"], signal["type"])

    for name, publish_fn in [
        ("Twitter", publish_to_twitter),
        ("Reddit", publish_to_reddit),
        ("Discord", publish_to_discord),
    ]:
        try:
            published = publish_fn(signal)
            logger.info("%s: %s", name, "publié" if published else "pas de publication cette fois")
        except Exception:
            logger.exception("%s: erreur inattendue, on continue avec les autres plateformes.", name)


def main():
    parser = argparse.ArgumentParser(description="Orchestrateur d'acquisition de trafic")
    parser.add_argument("--loop", action="store_true", help="Tourne en continu au lieu de faire une seule passe")
    args = parser.parse_args()

    _setup_logging()
    logger = logging.getLogger(__name__)

    if not args.loop:
        run_once()
        return

    logger.info("Démarrage en mode boucle (revérification toutes les %dh environ).", LOOP_CHECK_INTERVAL_SECONDS // 3600)
    while True:
        run_once()
        time.sleep(LOOP_CHECK_INTERVAL_SECONDS + random.randint(-600, 600))


if __name__ == "__main__":
    main()
