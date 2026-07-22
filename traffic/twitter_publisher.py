"""
Publication sur Twitter/X (API v2) avec le compte du développeur — un seul
compte, clés obtenues via https://developer.twitter.com (tier gratuit).
"""

import logging
import random
import time
from datetime import datetime, timezone

import tweepy

from config import (
    TWITTER_CONSUMER_KEY,
    TWITTER_CONSUMER_SECRET,
    TWITTER_ACCESS_TOKEN,
    TWITTER_ACCESS_TOKEN_SECRET,
    TWITTER_MAX_PER_DAY,
    TWITTER_MAX_PER_MONTH,
    TWITTER_MIN_DELAY_SECONDS,
    TWITTER_MAX_DELAY_SECONDS,
)
from content_templates import format_tweet
import supabase_client

logger = logging.getLogger(__name__)


def _get_client():
    if not all([TWITTER_CONSUMER_KEY, TWITTER_CONSUMER_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET]):
        raise RuntimeError("Clés Twitter manquantes dans .env")
    return tweepy.Client(
        consumer_key=TWITTER_CONSUMER_KEY,
        consumer_secret=TWITTER_CONSUMER_SECRET,
        access_token=TWITTER_ACCESS_TOKEN,
        access_token_secret=TWITTER_ACCESS_TOKEN_SECRET,
    )


def is_due():
    """
    Vérifie les plafonds quotidien et mensuel AVANT de tenter une publication.
    Ne code jamais un plafond en dur : les limites du tier gratuit de l'API
    Twitter ont changé plusieurs fois — configure TWITTER_MAX_PER_MONTH dans
    .env selon ce qu'affiche réellement ton compte développeur.
    """
    now = datetime.now(timezone.utc)
    start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    posted_today = supabase_client.count_posts_since("twitter", start_of_day)
    posted_this_month = supabase_client.count_posts_since("twitter", start_of_month)

    if posted_this_month >= TWITTER_MAX_PER_MONTH:
        logger.info("Twitter: plafond mensuel atteint (%d/%d), on saute.", posted_this_month, TWITTER_MAX_PER_MONTH)
        return False
    if posted_today >= TWITTER_MAX_PER_DAY:
        logger.info("Twitter: plafond quotidien atteint (%d/%d), on saute.", posted_today, TWITTER_MAX_PER_DAY)
        return False
    return True


def publish_to_twitter(signal, randomized_delay=True):
    """
    Publie un tweet pour `signal` si les plafonds le permettent et si ce
    signal n'a pas déjà été posté sur Twitter. Retourne True si un tweet a
    été publié, False sinon (plafond atteint, déjà publié, ou erreur gérée).
    """
    if not is_due():
        return False

    if signal["id"] in supabase_client.get_posted_signal_ids("twitter"):
        logger.info("Twitter: signal #%s déjà publié, on saute.", signal["id"])
        return False

    if randomized_delay:
        delay = random.randint(TWITTER_MIN_DELAY_SECONDS, TWITTER_MAX_DELAY_SECONDS)
        logger.info("Twitter: attente de %ds avant publication (espacement volontaire).", delay)
        time.sleep(delay)

    text = format_tweet(signal)
    try:
        client = _get_client()
        response = client.create_tweet(text=text)
        tweet_id = response.data.get("id") if response and response.data else None
        supabase_client.record_posted("twitter", signal["id"])
        logger.info("Twitter: tweet publié (id=%s) pour le signal #%s.", tweet_id, signal["id"])
        return True
    except tweepy.TweepyException:
        logger.exception("Twitter: échec de la publication pour le signal #%s.", signal["id"])
        return False
