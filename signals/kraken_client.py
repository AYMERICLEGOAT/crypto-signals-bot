"""
Client HTTP minimaliste pour l'API publique Kraken (aucune clé requise).
Quatrième niveau de repli, utilisé seulement quand Binance, CoinGecko ET
Coinbase Exchange ont tous les trois échoué pour une paire donnée (voir
main.py::fetch_recent_prices) -- le maillon "auto-réparation" de la liste
de sources de secours.

Kraken utilise des tickers historiques différents pour deux actifs de
notre univers (XBT pour BTC, XDG pour DOGE) ; _BASE_ALIASES corrige ce cas
particulier, le reste des paires utilise le symbole tel quel.
"""

import time
import logging
import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.kraken.com"

_BASE_ALIASES = {"BTC": "XBT", "DOGE": "XDG"}


def _get(path, params=None, max_retries=3, timeout=15):
    url = f"{BASE_URL}{path}"
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            if resp.status_code == 429:
                backoff = 5 * attempt
                logger.warning("Kraken 429 (rate limit), attente %ss avant retry", backoff)
                time.sleep(backoff)
                continue
            resp.raise_for_status()
            payload = resp.json()
            if payload.get("error"):
                raise RuntimeError(f"Kraken a renvoyé une erreur: {payload['error']}")
            return payload
        except requests.RequestException as exc:
            logger.warning("Erreur Kraken (tentative %s/%s): %s", attempt, max_retries, exc)
            time.sleep(3 * attempt)
    raise RuntimeError(f"Échec définitif de l'appel Kraken: {url}")


def pair_to_kraken_symbol(pair: str) -> str:
    """Convertit 'BTC/USDT' -> 'XBTUSDT' (format paire Kraken, avec alias de ticker si besoin)."""
    base = pair.split("/")[0]
    base = _BASE_ALIASES.get(base, base)
    return f"{base}USDT"


def get_klines(pair: str, limit: int = 250, interval_minutes: int = 60):
    """
    Bougies OHLC via /0/public/OHLC. `interval_minutes` doit être une des
    valeurs acceptées par Kraken : 1, 5, 15 (voir squeeze_engine.py), 30,
    60 (défaut), 240, 1440, 10080, 21600. Retourne une liste de tuples
    (open_time_ms, open, high, low, close, volume), triée par temps
    croissant (ordre natif de l'API). Kraken ne fournit pas de paramètre
    `limit` : il renvoie ses ~720 dernières bougies à cet intervalle, on
    tronque nous-même aux `limit` plus récentes.
    """
    symbol = pair_to_kraken_symbol(pair)
    data = _get("/0/public/OHLC", params={"pair": symbol, "interval": interval_minutes})
    result = data.get("result", {})
    # La clé du résultat n'est pas toujours identique au paramètre `pair`
    # envoyé (Kraken renvoie parfois un alias interne, ex: XXBTZUSD) --
    # on prend la première clé qui n'est pas "last".
    series_key = next((k for k in result if k != "last"), None)
    if series_key is None:
        return []
    candles = [
        (int(row[0]) * 1000, float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[6]))
        for row in result[series_key]
    ]
    return candles[-limit:]
