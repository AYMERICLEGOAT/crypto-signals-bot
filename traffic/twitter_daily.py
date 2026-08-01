"""
Point d'entrée pour la publication Twitter quotidienne (GitHub Actions,
voir .github/workflows/twitter.yml). Isolé de promo_main.py pour ne
déclencher QUE Twitter depuis ce workflow (pas Reddit/Discord).
"""

import logging

import preflight
import supabase_client
from twitter_publisher import publish_to_twitter, publish_macro_summary

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


def main():
    # Contrôle de configuration AVANT tout le reste : publish_to_twitter()
    # patiente jusqu'à 1800s (espacement volontaire, voir config.py) avant de
    # toucher l'API. Sans ce contrôle, un identifiant manquant coûtait ~17 min
    # de runner pour finir sur une erreur qui était connue dès la seconde 0.
    if not preflight.ensure_configured("twitter"):
        return

    signal = supabase_client.get_latest_signal()
    if not signal:
        logger.info("Aucun signal en base : publication du résumé macro à la place.")
        published = publish_macro_summary()
        logger.info("Twitter (résumé macro): %s", "publié" if published else "pas de publication cette fois")
        return

    logger.info("Signal considéré: #%s %s %s", signal["id"], signal["pair"], signal["type"])
    published = publish_to_twitter(signal)
    logger.info("Twitter: %s", "publié" if published else "pas de publication cette fois")


if __name__ == "__main__":
    main()
