"""
Résumé macro quotidien (prix BTC, volatilité 24h, position relative
EMA9/EMA21) — publié quand aucun signal réel n'existe, pour ne jamais
laisser les comptes Twitter/Discord silencieux. Contenu strictement
factuel (chiffres réels via l'API publique Binance), pas promotionnel :
aucune promesse, aucun appel à l'action commercial.
"""

import logging

import requests

logger = logging.getLogger(__name__)

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
BINANCE_TICKER_24H_URL = "https://api.binance.com/api/v3/ticker/24hr"


def _ema(values, period):
    ema = values[0]
    k = 2 / (period + 1)
    for v in values[1:]:
        ema = v * k + ema * (1 - k)
    return ema


def get_btc_macro_summary():
    """
    Retourne un dict {price, change_24h_pct, high_24h, low_24h, ema9, ema21,
    position} basé sur des données Binance réelles, ou None si l'API est
    indisponible (ne jamais inventer de chiffres à la place).
    """
    try:
        ticker_resp = requests.get(BINANCE_TICKER_24H_URL, params={"symbol": "BTCUSDT"}, timeout=15)
        ticker_resp.raise_for_status()
        ticker = ticker_resp.json()

        klines_resp = requests.get(
            BINANCE_KLINES_URL, params={"symbol": "BTCUSDT", "interval": "1h", "limit": 50}, timeout=15
        )
        klines_resp.raise_for_status()
        closes = [float(k[4]) for k in klines_resp.json()]

        ema9 = _ema(closes[-9:], 9)
        ema21 = _ema(closes[-21:], 21)

        return {
            "price": float(ticker["lastPrice"]),
            "change_24h_pct": float(ticker["priceChangePercent"]),
            "high_24h": float(ticker["highPrice"]),
            "low_24h": float(ticker["lowPrice"]),
            "ema9": ema9,
            "ema21": ema21,
            "position": "au-dessus de" if ema9 > ema21 else "en dessous de",
        }
    except Exception:
        logger.exception("Échec de la récupération du résumé macro BTC (Binance).")
        return None


def _volatility_pct(summary):
    return (summary["high_24h"] - summary["low_24h"]) / summary["price"] * 100


def format_macro_tweet(summary: dict) -> str:
    volatility = _volatility_pct(summary)
    price_str = f"{summary['price']:,.0f}".replace(",", " ")
    return (
        f"📊 Résumé marché — BTC/USDT\n\n"
        f"Prix : {price_str} $ ({summary['change_24h_pct']:+.1f}% / 24h)\n"
        f"Volatilité 24h : {volatility:.1f}%\n"
        f"EMA9 {summary['position']} EMA21 (bougies 1h)\n\n"
        f"Contenu factuel, pas un conseil en investissement.\n"
        f"#Bitcoin #Crypto"
    )


def format_macro_discord_embed(summary: dict) -> dict:
    volatility = _volatility_pct(summary)
    price_str = f"{summary['price']:,.0f} $".replace(",", " ")
    return {
        "content": "📊 Résumé marché du jour (aucun signal détecté aujourd'hui)",
        "embeds": [{
            "title": "BTC/USDT",
            "color": 0x6366F1,
            "fields": [
                {"name": "Prix", "value": price_str, "inline": True},
                {"name": "Variation 24h", "value": f"{summary['change_24h_pct']:+.1f}%", "inline": True},
                {"name": "Volatilité 24h", "value": f"{volatility:.1f}%", "inline": True},
                {"name": "EMA9 vs EMA21 (1h)", "value": f"EMA9 {summary['position']} EMA21", "inline": False},
            ],
            "footer": {"text": "Contenu factuel, pas un conseil en investissement."},
        }],
    }
