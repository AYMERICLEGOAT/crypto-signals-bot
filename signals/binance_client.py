"""Client des données publiques Binance avec bascule géographique sûre."""

import json
import logging
import time
import requests

logger = logging.getLogger(__name__)
BASE_URLS = ("https://api.binance.com", "https://data-api.binance.vision")

_INTERVAL_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000}


def _get(path, params=None, max_retries=3, timeout=15):
    errors = []
    for base_url in BASE_URLS:
        url = f"{base_url}{path}"
        for attempt in range(1, max_retries + 1):
            try:
                resp = requests.get(url, params=params, timeout=timeout)
                if resp.status_code == 451:
                    logger.warning("Binance 451 via %s; bascule vers la source publique suivante.", base_url)
                    break
                if resp.status_code in (429, 418):
                    header = resp.headers.get("Retry-After")
                    backoff = int(header) if header and header.isdigit() else 10 * attempt
                    logger.warning("Binance %s via %s; attente %ss.", resp.status_code, base_url, backoff)
                    time.sleep(backoff)
                    continue
                resp.raise_for_status()
                return resp.json()
            except requests.RequestException as exc:
                errors.append(f"{base_url}: {exc}")
                logger.warning("Erreur Binance via %s (tentative %s/%s): %s", base_url, attempt, max_retries, exc)
                time.sleep(3 * attempt)
    raise RuntimeError(f"Échec des sources Binance pour {path}: {'; '.join(errors)}")


def pair_to_symbol(pair: str) -> str:
    return pair.replace("/", "")


def get_current_prices(symbols):
    data = _get("/api/v3/ticker/price", params={"symbols": json.dumps(symbols, separators=(",", ":"))})
    return {row["symbol"]: float(row["price"]) for row in data}


def get_klines(symbol, interval="1h", limit=100, start_ms=None, end_ms=None):
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    if start_ms is not None:
        params["startTime"] = start_ms
    if end_ms is not None:
        params["endTime"] = end_ms
    data = _get("/api/v3/klines", params=params)
    return [(int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])) for row in data]


def get_historical_klines(symbol, interval="1h", days=180):
    interval_ms = _INTERVAL_MS[interval]
    end_ms = int(time.time() * 1000)
    cursor = end_ms - days * 24 * 60 * 60 * 1000
    all_candles = []
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
