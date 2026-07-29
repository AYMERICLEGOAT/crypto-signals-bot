"""
Client HTTP minimaliste pour l'API publique CoinGecko (aucune clé requise).
Gère un rate-limit local pour rester sous COINGECKO_MAX_CALLS_PER_MINUTE
et retente automatiquement en cas d'erreur réseau ou de code 429.
"""

import time
import logging
import requests

from config import COINGECKO_BASE_URL, COINGECKO_MAX_CALLS_PER_MINUTE

logger = logging.getLogger(__name__)

# Délai minimum entre deux appels pour respecter le quota/minute.
_MIN_DELAY_BETWEEN_CALLS = 60.0 / COINGECKO_MAX_CALLS_PER_MINUTE
_last_call_ts = 0.0


def _throttle():
    """Attend le temps nécessaire pour ne pas dépasser le quota d'appels/minute."""
    global _last_call_ts
    elapsed = time.time() - _last_call_ts
    wait = _MIN_DELAY_BETWEEN_CALLS - elapsed
    if wait > 0:
        time.sleep(wait)
    _last_call_ts = time.time()


def _get(path, params=None, max_retries=6):
    """
    GET générique avec throttling + retry/backoff exponentiel.

    max_retries relevé de 3 à 6 (2026-07-29) : le quota CoinGecko gratuit est
    partagé par IP entre tous les jobs GitHub Actions en cours (pas
    seulement les nôtres), donc un 429 est souvent transitoire (une rafale
    d'un AUTRE job sur la même IP) plutôt qu'un vrai dépassement de notre
    quota. 3 tentatives (max ~60s d'attente cumulée) abandonnait trop tôt et
    faisait échouer des paires entières pour le cycle ; 6 tentatives laisse
    largement le temps à la contention de se résorber, sans risque vu la
    cadence horaire du cron (5-6 min de retry de plus ne coûtent rien).
    """
    url = f"{COINGECKO_BASE_URL}{path}"
    for attempt in range(1, max_retries + 1):
        _throttle()
        try:
            resp = requests.get(url, params=params, timeout=15)
            if resp.status_code == 429:
                # Trop d'appels : on attend plus longtemps avant de réessayer.
                backoff = 10 * attempt
                logger.warning("CoinGecko 429 (rate limit), attente %ss avant retry", backoff)
                time.sleep(backoff)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.warning("Erreur CoinGecko (tentative %s/%s): %s", attempt, max_retries, exc)
            time.sleep(5 * attempt)
    raise RuntimeError(f"Échec définitif de l'appel CoinGecko: {url}")


def get_current_prices(coin_ids):
    """
    Récupère le prix USD actuel pour une liste d'identifiants CoinGecko,
    en un seul appel HTTP (endpoint /simple/price).

    Retourne un dict {coin_id: prix_float}.
    """
    ids_param = ",".join(coin_ids)
    data = _get("/simple/price", params={"ids": ids_param, "vs_currencies": "usd"})
    return {coin_id: values["usd"] for coin_id, values in data.items() if "usd" in values}


def get_intraday_history(coin_id, days=1):
    """
    Historique fin (~5 minutes sur le plan gratuit pour days=1) via
    /coins/{id}/market_chart. Utilisé pour amorcer le cache local au
    démarrage afin de disposer immédiatement d'assez de points pour
    calculer les indicateurs.

    Retourne une liste de tuples (timestamp_ms, prix).
    """
    data = _get(f"/coins/{coin_id}/market_chart", params={"vs_currency": "usd", "days": days})
    return [(int(ts), float(price)) for ts, price in data.get("prices", [])]


def get_ohlc(coin_id, days=180):
    """
    Bougies OHLC via /coins/{id}/ohlc. Sur le plan gratuit, la granularité
    dépend de `days` (CoinGecko l'ajuste automatiquement : journalière
    au-delà de 90 jours). Utilisé uniquement pour le backtest.

    Retourne une liste de tuples (timestamp_ms, open, high, low, close).
    """
    data = _get(f"/coins/{coin_id}/ohlc", params={"vs_currency": "usd", "days": days})
    return [(int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4])) for row in data]
