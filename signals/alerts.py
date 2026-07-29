"""
Alerte admin directe (Telegram) pour les pannes détectées depuis le module
de signaux lui-même -- distinct de l'alerte "le job n'a pas tourné depuis
3h" du Worker (workers/main-worker/src/cron/monitorSignalsHeartbeat.ts,
voir storage.record_heartbeat) : ici, le job Python tourne bien et se
termine "avec succès" au sens process, mais les 4 sources de données
(Binance/CoinGecko/Coinbase/Kraken, voir main.py::fetch_recent_prices) ont
toutes échoué pour TOUTES les paires plusieurs cycles de suite -- un état
que le heartbeat seul ne peut pas détecter puisqu'il se rafraîchit à
chaque exécution, panne de données ou non.
"""

import logging
import requests

import config

logger = logging.getLogger(__name__)

TELEGRAM_API_BASE = "https://api.telegram.org/bot"


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
    if not config.TELEGRAM_BOT_TOKEN or not config.ADMIN_TELEGRAM_ID:
        logger.warning(
            "Panne totale des sources de données depuis %d cycles, mais TELEGRAM_BOT_TOKEN/"
            "ADMIN_TELEGRAM_ID absents -- alerte non envoyée.", consecutive_failures,
        )
        return

    text = (
        f"🚨 Panne totale des sources de données de marché depuis {consecutive_failures} cycles consécutifs.\n\n"
        "Binance, CoinGecko, Coinbase Exchange ET Kraken ont tous échoué pour TOUTES les paires -- "
        "aucun signal ne peut être généré tant que ça dure. Vérifie les logs du workflow "
        '"Signaux crypto (horaire)" sur GitHub Actions.'
    )
    try:
        resp = requests.post(
            f"{TELEGRAM_API_BASE}{config.TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": config.ADMIN_TELEGRAM_ID, "text": text},
            timeout=15,
        )
        if not resp.ok:
            logger.error("Échec de l'alerte Telegram de panne totale: %s %s", resp.status_code, resp.text)
    except Exception:
        logger.exception("Échec de l'envoi de l'alerte Telegram de panne totale.")
