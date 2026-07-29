"""
Alertes admin directes (Telegram) pour les pannes détectées depuis le
module de signaux lui-même -- distinctes de l'alerte "le job n'a pas
tourné depuis 3h" du Worker (workers/main-worker/src/cron/
monitorSignalsHeartbeat.ts, voir storage.record_heartbeat) : dans les deux
cas ci-dessous, le job Python tourne bien et se termine "avec succès" au
sens process, mais un problème réel reste invisible au heartbeat seul
(qui se rafraîchit à chaque exécution, panne ou non) :
  - maybe_alert_data_outage : les 4 sources de données (Binance/CoinGecko/
    Coinbase/Kraken) ont toutes échoué pour TOUTES les paires plusieurs
    cycles de suite (aucune donnée à traiter).
  - alert_insert_failure : un signal a bien été détecté mais son
    enregistrement dans Supabase a échoué (donnée traitée, mais perdue à
    l'écriture) -- voir storage.insert_signal.
"""

import logging
import requests

import config

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org/bot"


def _send_admin_message(text: str, context: str) -> None:
    if not config.TELEGRAM_BOT_TOKEN or not config.ADMIN_TELEGRAM_ID:
        logger.warning("%s, mais TELEGRAM_BOT_TOKEN/ADMIN_TELEGRAM_ID absents -- alerte non envoyée.", context)
        return
    try:
        resp = requests.post(
            f"{TELEGRAM_API_BASE}{config.TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": config.ADMIN_TELEGRAM_ID, "text": text},
            timeout=15,
        )
        if not resp.ok:
            logger.error("Échec de l'alerte Telegram (%s): %s %s", context, resp.status_code, resp.text)
    except Exception:
        logger.exception("Échec de l'envoi de l'alerte Telegram (%s).", context)


def alert_insert_failure(failed_count: int, total_candidates: int) -> None:
    """
    Appelé immédiatement (pas de seuil de cycles consécutifs, contrairement
    à maybe_alert_data_outage) : un signal détecté qui échoue à l'écriture
    Supabase est un événement rare et précieux perdu -- voir
    storage.insert_signal -- toujours digne d'une alerte au premier coup,
    pas seulement si ça persiste.
    """
    _send_admin_message(
        f"🚨 {failed_count}/{total_candidates} signal(aux) détecté(s) ce cycle mais PAS enregistré(s) "
        "dans Supabase (échec d'insertion). Vérifie les logs du workflow \"Signaux crypto (horaire)\" "
        "et l'état de la table `signals` (clé API, RLS, schéma).",
        context="échec d'insertion de signal",
    )


def maybe_alert_data_outage(consecutive_failures: int) -> None:
    """
    Envoie une alerte Telegram à l'admin. Appelé uniquement quand le
    compteur de cycles consécutifs en panne totale vient de franchir le
    seuil (voir storage.record_source_health, qui retourne 0 dès qu'un seul
    signal de vie revient -- l'appelant ne rappelle donc cette fonction
    qu'une fois par panne réelle, pas à chaque cycle en panne).
    Dégradation silencieuse si TELEGRAM_BOT_TOKEN/ADMIN_TELEGRAM_ID ne sont
    pas configurés (ex: exécution locale de dev) : ne doit jamais faire
    échouer le job pour une alerte manquante.
    """
    _send_admin_message(
        f"🚨 Panne totale des sources de données de marché depuis {consecutive_failures} cycles consécutifs.\n\n"
        "Binance, CoinGecko, Coinbase Exchange ET Kraken ont tous échoué pour TOUTES les paires -- "
        "aucun signal ne peut être généré tant que ça dure. Vérifie les logs du workflow "
        '"Signaux crypto (horaire)" sur GitHub Actions.',
        context=f"panne totale des sources de données depuis {consecutive_failures} cycles",
    )
