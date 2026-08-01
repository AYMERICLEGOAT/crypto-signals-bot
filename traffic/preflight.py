"""
Contrôle de configuration des canaux d'acquisition, exécuté AVANT tout
travail (audit du 01/08/2026).

Constat : Twitter et Reddit échouaient tous les jours depuis au moins le
29/07 — donc deux des trois canaux d'acquisition étaient morts en
permanence, alors que le projet n'a que 2 utilisateurs et que le vrai
problème du moment est justement de faire venir du monde.

Deux défauts rendaient ces pannes invisibles en pratique :

  1. Le workflow Twitter attendait jusqu'à 1027 secondes (espacement
     volontaire des publications) AVANT de tenter l'appel API et d'échouer
     sur un 403. Dix-sept minutes de runner brûlées pour un problème de
     configuration connu d'avance.
  2. L'alerte envoyée à l'administrateur disait seulement « Échec du
     workflow X ». Répétée quotidiennement et sans indiquer quoi corriger,
     elle éduque à ignorer les alertes plutôt qu'à agir.

Ce module vérifie les identifiants en premier et, s'ils manquent ou sont
invalides, arrête proprement en expliquant EXACTEMENT quoi faire et où.
Un problème de configuration n'est pas une panne : le script sort en code 0
(le workflow reste vert) pour ne pas noyer de vraies pannes dans un échec
quotidien permanent — mais l'administrateur est prévenu, sans répétition
inutile (voir _already_notified_recently).
"""

import logging
import os
from datetime import datetime, timezone

import config

logger = logging.getLogger(__name__)

TWITTER_KEYS = [
    "TWITTER_CONSUMER_KEY",
    "TWITTER_CONSUMER_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_TOKEN_SECRET",
]
REDDIT_KEYS = [
    "REDDIT_CLIENT_ID",
    "REDDIT_CLIENT_SECRET",
    "REDDIT_USERNAME",
    "REDDIT_PASSWORD",
]

_SETUP_HELP = {
    "twitter": (
        "Twitter/X — marche à suivre :\n"
        "1. https://developer.x.com/en/portal/dashboard > ton app > Settings\n"
        "2. « User authentication settings » > App permissions : passer à « Read and Write »\n"
        "3. Onglet « Keys and tokens » : RÉGÉNÉRER les Access Token & Secret\n"
        "   (indispensable — les anciens gardent l'ancienne permission en lecture seule,\n"
        "    c'est la cause du 403 Forbidden)\n"
        "4. GitHub > Settings > Secrets and variables > Actions : mettre à jour\n"
        "   TWITTER_ACCESS_TOKEN et TWITTER_ACCESS_TOKEN_SECRET"
    ),
    "reddit": (
        "Reddit — marche à suivre :\n"
        "1. https://www.reddit.com/prefs/apps > « create another app » > type « script »\n"
        "2. Noter le client id (sous le nom de l'app) et le secret\n"
        "3. GitHub > Settings > Secrets and variables > Actions : ajouter les 4 secrets\n"
        "   REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD\n"
        "4. Le compte Reddit doit avoir un minimum de karma, sinon les subreddits\n"
        "   crypto rejettent les posts automatiquement (règle anti-spam)"
    ),
}


def missing_credentials(channel: str) -> list[str]:
    """Noms des identifiants absents ou vides pour ce canal."""
    keys = TWITTER_KEYS if channel == "twitter" else REDDIT_KEYS
    return [k for k in keys if not (getattr(config, k, "") or os.getenv(k, "")).strip()]


def _notify_admin(text: str) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    admin = os.getenv("ADMIN_TELEGRAM_ID", "8647576528")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN absent : alerte non envoyée.")
        return
    try:
        import requests

        requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": int(admin), "text": text},
            timeout=10,
        )
    except Exception:
        logger.exception("Échec de l'envoi de l'alerte de configuration.")


NOTIFY_INTERVAL_HOURS = 24


def _already_notified_recently(channel: str) -> bool:
    """
    Anti-répétition : une configuration manquante est un ÉTAT durable, pas un
    événement. Prévenir une fois par jour suffit ; au-delà l'alerte devient du
    bruit qu'on apprend à ignorer — ce qui est exactement ce qui s'est passé
    avec l'alerte générique « Échec du workflow » répétée quotidiennement.

    Stocké dans system_heartbeats (job_name en clé primaire, last_run_at) :
    table déjà prévue pour ce genre de suivi, aucun schéma à ajouter.
    """
    job = f"preflight_{channel}"
    try:
        import supabase_client

        client = supabase_client._get_client()
        res = client.table("system_heartbeats").select("last_run_at").eq("job_name", job).limit(1).execute()
        now = datetime.now(timezone.utc)
        if res.data:
            last = res.data[0].get("last_run_at")
            if last:
                previous = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
                if (now - previous).total_seconds() < NOTIFY_INTERVAL_HOURS * 3600:
                    return True
            client.table("system_heartbeats").update(
                {"last_run_at": now.isoformat()}
            ).eq("job_name", job).execute()
        else:
            client.table("system_heartbeats").insert(
                {"job_name": job, "last_run_at": now.isoformat()}
            ).execute()
        return False
    except Exception:
        # En cas de doute on notifie : mieux vaut une alerte en trop qu'une
        # panne d'acquisition silencieuse.
        logger.exception("Impossible de vérifier l'anti-répétition des alertes de configuration.")
        return False


def ensure_configured(channel: str) -> bool:
    """
    True si le canal est configuré et le script peut continuer.
    False s'il manque des identifiants — l'appelant doit alors s'arrêter
    proprement (sans code d'erreur : ce n'est pas une panne, c'est une
    configuration à compléter).
    """
    missing = missing_credentials(channel)
    if not missing:
        return True

    help_text = _SETUP_HELP.get(channel, "")
    logger.error(
        "%s : canal NON CONFIGURÉ, publication impossible. Identifiants absents : %s",
        channel.capitalize(), ", ".join(missing),
    )
    logger.error("%s", help_text)

    if not _already_notified_recently(channel):
        _notify_admin(
            f"🔧 Canal {channel.capitalize()} non configuré — aucune publication possible.\n\n"
            f"Identifiants absents : {', '.join(missing)}\n\n{help_text}\n\n"
            "Tant que ce n'est pas fait, ce canal n'amène aucun visiteur."
        )
    return False


def report_auth_failure(channel: str, detail: str) -> None:
    """
    Identifiants présents mais refusés par la plateforme (403/401). Distinct
    d'un identifiant manquant : ici c'est une question de PERMISSIONS, pas de
    valeur absente — la marche à suivre n'est pas la même.
    """
    help_text = _SETUP_HELP.get(channel, "")
    logger.error("%s : identifiants refusés par la plateforme (%s).", channel.capitalize(), detail)
    if not _already_notified_recently(f"{channel}-auth"):
        _notify_admin(
            f"⛔ Canal {channel.capitalize()} : identifiants REFUSÉS par la plateforme ({detail}).\n\n"
            "Les clés existent mais n'ont pas les droits nécessaires.\n\n"
            f"{help_text}"
        )
