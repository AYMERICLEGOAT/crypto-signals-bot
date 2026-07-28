"""
Client HTTP minimaliste pour l'API publique Binance (aucune clé requise
pour les données de marché). Source de données PRINCIPALE depuis la
migration vers GitHub Actions : plus fiable et bien moins limitée que
CoinGecko (voir coingecko_client.py, conservé comme fallback en cas
d'indisponibilité de Binance).
"""

import time
import json
import logging
import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://api.binance.com"

_INTERVAL_MS = {
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
}


def _get(path, params=None, max_retries=3, timeout=15):
    """GET générique avec retry/backoff exponentiel (429/418 = rate limit Binance)."""
    url = f"{BASE_URL}{path}"
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            if resp.status_code in (429, 418):
                backoff = 10 * attempt
                logger.warning("Binance %s (rate limit), attente %ss avant retry", resp.status_code, backoff)
                time.sleep(backoff)
                continue
            if resp.status_code == 451:
                # Blocage géographique permanent (observé systématiquement depuis les
                # runners GitHub Actions) : retenter n'aide jamais, contrairement au
                # 429/418 ci-dessus. On échoue tout de suite pour laisser l'appelant
                # basculer sur CoinGecko sans gaspiller ~18s/paire en retries voués à l'échec.
                raise RuntimeError(f"Binance bloqué géographiquement (451): {url}")
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            logger.warning("Erreur Binance (tentative %s/%s): %s", attempt, max_retries, exc)
            time.sleep(3 * attempt)
    raise RuntimeError(f"Échec définitif de l'appel Binance: {url}")


def pair_to_symbol(pair: str) -> str:
    """Convertit 'BTC/USDT' -> 'BTCUSDT' (format symbole Binance)."""
    return pair.replace("/", "")


def get_current_prices(symbols):
    """
    Prix actuel pour une liste de symboles Binance (ex: ["BTCUSDT", "ETHUSDT"]),
    en un seul appel HTTP (endpoint /api/v3/ticker/price).
    Retourne un dict {symbol: prix_float}.
    """
    # separators=(",", ":") : Binance rejette les espaces dans le tableau JSON
    # (json.dumps en ajoute un par défaut après chaque virgule).
    data = _get("/api/v3/ticker/price", params={"symbols": json.dumps(symbols, separators=(",", ":"))})
    return {row["symbol"]: float(row["price"]) for row in data}


def get_klines(symbol, interval="1h", limit=100, start_ms=None, end_ms=None):
    """
    Bougies OHLCV via /api/v3/klines.
    Retourne une liste de tuples (open_time_ms, open, high, low, close, volume),
    triée par temps croissant (ordre natif de l'API).
    """
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    if start_ms is not None:
        params["startTime"] = start_ms
    if end_ms is not None:
        params["endTime"] = end_ms
    data = _get("/api/v3/klines", params=params)
    return [
        (int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5]))
        for row in data
    ]


def get_historical_klines(symbol, interval="1h", days=180):
    """
    Récupère l'historique complet sur `days` jours en paginant par blocs de
    1000 bougies (limite de l'API par requête). Utilisé pour le backtest.
    """
    interval_ms = _INTERVAL_MS[interval]
    end_ms = int(time.time() * 1000)
    start_ms = end_ms - days * 24 * 60 * 60 * 1000

    all_candles = []
    cursor = start_ms
    while cursor < end_ms:
        batch = get_klines(symbol, interval=interval, limit=1000, start_ms=cursor, end_ms=end_ms)
        if not batch:
            break
        all_candles.extend(batch)
        next_cursor = batch[-1][0] + interval_ms
        if next_cursor <= cursor:
            break
        cursor = next_cursor
        if len(batch) < 1000:
            break
    return all_candles
