"""
Client HTTP minimaliste pour l'API publique Coinbase Exchange (aucune clé
requise). Troisième niveau de repli (voir main.py::fetch_recent_prices) :
couverture à 100% des 28 paires de l'univers avec un mapping trivial
(BASE-USD, sans exception de ticker contrairement à Kraken -- XBT/XDG,
voir kraken_client.py), ce qui en fait un meilleur troisième niveau que
quatrième.
"""

import time
import logging
import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.exchange.coinbase.com"
_GRANULARITY_SECONDS = 3600  # 1h, cohérent avec les autres sources


def _get(path, params=None, max_retries=3, timeout=15):
    url = f"{BASE_URL}{path}"
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": "crypto-signals-bot"})
            if resp.status_code == 429:
                backoff = 5 * attempt
                logger.warning("Coinbase Exchange 429 (rate limit), attente %ss avant retry", backoff)
                time.sleep(backoff)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.warning("Erreur Coinbase Exchange (tentative %s/%s): %s", attempt, max_retries, exc)
            time.sleep(3 * attempt)
    raise RuntimeError(f"Échec définitif de l'appel Coinbase Exchange: {url}")


def pair_to_product_id(pair: str) -> str:
    """Convertit 'BTC/USDT' -> 'BTC-USD' (Coinbase Exchange ne liste pas de paires -USDT pour la plupart des alts)."""
    base = pair.split("/")[0]
    return f"{base}-USD"


def get_klines(pair: str, limit: int = 250):
    """
    Bougies OHLCV via /products/{id}/candles. Coinbase plafonne à 300
    bougies par requête (largement suffisant pour KLINES_LOOKBACK=250).
    Retourne une liste de tuples (open_time_ms, open, high, low, close,
    volume) triée par temps croissant (l'API renvoie l'ordre inverse).
    """
    product_id = pair_to_product_id(pair)
    now = int(time.time())
    start = now - min(limit, 300) * _GRANULARITY_SECONDS
    data = _get(
        f"/products/{product_id}/candles",
        params={"granularity": _GRANULARITY_SECONDS, "start": start, "end": now},
    )
    # Format Coinbase : [time, low, high, open, close, volume]
    candles = [
        (int(row[0]) * 1000, float(row[3]), float(row[2]), float(row[1]), float(row[4]), float(row[5]))
        for row in data
    ]
    candles.sort(key=lambda c: c[0])
    return candles
