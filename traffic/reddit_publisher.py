"""
Publication sur Reddit via PRAW, avec un compte Reddit existant unique
("script app" créée sur https://www.reddit.com/prefs/apps).

⚠️ À lire avant d'activer ce module : utiliser l'API officielle avec un
compte légitime ne dispense pas de respecter les règles D'AUTO-PROMOTION
PROPRES À CHAQUE SUBREDDIT. La plupart des subreddits crypto (r/CryptoCurrency
en particulier) interdisent ou encadrent strictement les liens vers des
bots/canaux payants, exigent un ratio de participation avant tout post
promotionnel, et peuvent bannir un compte qui poste du contenu automatisé
sans autorisation préalable des modérateurs — même si le post est bien
formulé et espacé. Vérifie manuellement les règles de chaque subreddit
listé dans REDDIT_SUBREDDITS avant de les activer (voir README).
"""

import logging

import praw
import prawcore
from datetime import datetime, timezone

from config import (
    REDDIT_CLIENT_ID,
    REDDIT_CLIENT_SECRET,
    REDDIT_USERNAME,
    REDDIT_PASSWORD,
    REDDIT_USER_AGENT,
    REDDIT_SUBREDDITS,
    REDDIT_MIN_INTERVAL_DAYS,
)
from content_templates import format_reddit_post
import supabase_client

logger = logging.getLogger(__name__)


def _get_client():
    required = [REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD]
    if not all(required):
        raise RuntimeError("Identifiants Reddit manquants dans .env")
    return praw.Reddit(
        client_id=REDDIT_CLIENT_ID,
        client_secret=REDDIT_CLIENT_SECRET,
        username=REDDIT_USERNAME,
        password=REDDIT_PASSWORD,
        user_agent=REDDIT_USER_AGENT,
    )


def is_due():
    last_post = supabase_client.get_last_post("reddit")
    if not last_post:
        return True
    last_posted_at = datetime.fromisoformat(last_post["posted_at"].replace("Z", "+00:00"))
    elapsed_days = (datetime.now(timezone.utc) - last_posted_at).total_seconds() / 86400
    if elapsed_days < REDDIT_MIN_INTERVAL_DAYS:
        logger.info("Reddit: dernier post il y a %.1fj (< %dj requis), on saute.", elapsed_days, REDDIT_MIN_INTERVAL_DAYS)
        return False
    return True


def _rotation_order():
    """Ordre des subreddits à essayer, en repartant juste après le dernier utilisé."""
    if not REDDIT_SUBREDDITS:
        return []
    last_post = supabase_client.get_last_post("reddit")
    last_target = last_post["target"] if last_post else None
    if last_target in REDDIT_SUBREDDITS:
        start = (REDDIT_SUBREDDITS.index(last_target) + 1) % len(REDDIT_SUBREDDITS)
    else:
        start = 0
    return REDDIT_SUBREDDITS[start:] + REDDIT_SUBREDDITS[:start]


def publish_to_reddit(signal):
    """
    Publie une analyse pour `signal`, en essayant les subreddits configurés
    en rotation (le suivant en cas d'échec sur l'un d'eux : banni, supprimé,
    règles d'auto-promotion...). Retourne True si publié quelque part, False sinon.
    """
    if not is_due():
        return False

    if signal["id"] in supabase_client.get_posted_signal_ids("reddit"):
        logger.info("Reddit: signal #%s déjà publié, on saute.", signal["id"])
        return False

    candidates = _rotation_order()
    if not candidates:
        logger.warning("Reddit: aucun subreddit configuré (REDDIT_SUBREDDITS).")
        return False

    title, body = format_reddit_post(signal)
    reddit = _get_client()

    for subreddit_name in candidates:
        try:
            subreddit = reddit.subreddit(subreddit_name)
            submission = subreddit.submit(title=title, selftext=body)
            supabase_client.record_posted("reddit", signal["id"], target=subreddit_name)
            logger.info("Reddit: publié sur r/%s (id=%s) pour le signal #%s.", subreddit_name, submission.id, signal["id"])
            return True
        except prawcore.exceptions.Forbidden:
            logger.error(
                "Reddit: r/%s a refusé le post (banni, permissions insuffisantes, ou règle "
                "d'auto-promotion) — on essaie le suivant.",
                subreddit_name,
            )
        except prawcore.exceptions.NotFound:
            logger.error(
                "Reddit: r/%s introuvable (supprimé ou renommé) — retire-le de REDDIT_SUBREDDITS. "
                "On essaie le suivant.",
                subreddit_name,
            )
        except praw.exceptions.RedditAPIException as exc:
            logger.error("Reddit: l'API a refusé le post sur r/%s (%s) — on essaie le suivant.", subreddit_name, exc)
        except Exception:
            logger.exception("Reddit: échec inattendu sur r/%s — on essaie le suivant.", subreddit_name)

    # Audit#3/#6 : contrairement à un rejet sur UN subreddit (normal, on tourne
    # sur le suivant), échouer sur TOUS les subreddits configurés est une vraie
    # panne (identifiants invalides, API Reddit indisponible, etc.) — elle doit
    # faire échouer le job GitHub Actions, pas rester invisible derrière un
    # simple False comme pour Twitter avant ce correctif.
    logger.error("Reddit: aucun des subreddits configurés n'a accepté le post aujourd'hui.")
    raise RuntimeError("Reddit: échec de publication sur l'ensemble des subreddits configurés.")
