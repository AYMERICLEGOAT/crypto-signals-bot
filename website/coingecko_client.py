"""
Client HTTP minimaliste pour l'API publique CoinGecko (aucune clé requise).
Même logique de rate-limiting que le module signals/ (10 appels/minute max).
Utilisé ici uniquement pour récupérer le prix courant et évaluer si un
signal passé a atteint son take profit ou son stop loss.
"""

import time
import requests

from config import COINGECKO_BASE_URL, COINGECKO_MAX_CALLS_PER_MINUTE

_MIN_DELAY_BETWEEN_CALLS = 60.0 / COINGECKO_MAX_CALLS_PER_MINUTE
_last_call_ts = 0.0


def _throttle():
    global _last_call_ts
    elapsed = time.time() - _last_call_ts
    wait = _MIN_DELAY_BETWEEN_CALLS - elapsed
    if wait > 0:
        time.sleep(wait)
    _last_call_ts = time.time()


def get_current_prices(coin_ids):
    """Retourne {coin_id: prix_usd} pour une liste d'identifiants CoinGecko, en un seul appel."""
    if not coin_ids:
        return {}
    _throttle()
    resp = requests.get(
        f"{COINGECKO_BASE_URL}/simple/price",
        params={"ids": ",".join(sorted(set(coin_ids))), "vs_currencies": "usd"},
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    return {coin_id: values["usd"] for coin_id, values in data.items() if "usd" in values}
