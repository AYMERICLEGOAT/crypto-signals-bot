"""
Moteur "⚡ Squeeze Volatilité 15M" — second moteur de génération de signaux,
totalement indépendant du moteur "🎯 Haute Confiance" (EMA/RSI 1h, voir
strategy.py). Les deux tournent en parallèle sur le même cycle horaire
(voir main.py::run_once) et s'additionnent pour augmenter la fréquence de
signaux sans se marcher dessus : chaque signal est étiqueté par son moteur
d'origine (colonne `engine`, voir init.sql section 40 et
workers/main-worker/src/signalFormat.ts pour le badge affiché à l'abonné).

Logique : une phase de compression de volatilité (bandes de Bollinger dont
la largeur relative est proche de son minimum sur les SQUEEZE_LOOKBACK
dernières bougies 15 min) précède souvent un mouvement directionnel fort.
Le signal se déclenche à la CASSURE (clôture hors bande) qui suit une
telle compression, confirmée par un volume supérieur à sa moyenne récente
(filtre anti-faux-départ : une cassure sans volume est un signal fragile,
voir backtest_squeeze.py pour la validation empirique de ce filtre).
"""

from datetime import datetime, timezone

import pandas as pd

import config

ENGINE_NAME = "squeeze_15m"


def _pd_isna(value) -> bool:
    return pd.isna(value)


def _build_signal(pair: str, side: str, entry_price: float, atr_val: float, timestamp=None) -> dict:
    stop_dist = config.SQUEEZE_SL_MULTIPLIER * atr_val
    tp1_dist = config.SQUEEZE_TP1_MULTIPLIER * atr_val
    tp2_dist = config.SQUEEZE_TP2_MULTIPLIER * atr_val
    tp3_dist = config.SQUEEZE_TP3_MULTIPLIER * atr_val

    if side == "BUY":
        stop_loss = entry_price - stop_dist
        tp1_price, tp2_price, tp3_price = entry_price + tp1_dist, entry_price + tp2_dist, entry_price + tp3_dist
    else:
        stop_loss = entry_price + stop_dist
        tp1_price, tp2_price, tp3_price = entry_price - tp1_dist, entry_price - tp2_dist, entry_price - tp3_dist

    return {
        "pair": pair,
        "type": side,
        "entry_price": round(entry_price, 8),
        "stop_loss": round(stop_loss, 8),
        "take_profit": round(tp2_price, 8),
        "tp1_price": round(tp1_price, 8),
        "tp2_price": round(tp2_price, 8),
        "tp3_price": round(tp3_price, 8),
        "created_at": (timestamp or datetime.now(timezone.utc)).isoformat(),
        "engine": ENGINE_NAME,
    }


def detect_squeeze_signal(df: pd.DataFrame, pair: str, min_points: int = None) -> dict | None:
    """
    `df` doit être un DataFrame 15 minutes déjà enrichi par
    indicators.compute_all_indicators (colonnes bb_upper/bb_mid/bb_lower,
    atr, volume). Retourne un dict signal ou None.

    Condition d'entrée :
      1. Compression récente : la largeur de bande relative
         ((bb_upper - bb_lower) / bb_mid) de l'avant-dernière bougie était
         dans le SQUEEZE_PERCENTILE le plus bas des SQUEEZE_LOOKBACK
         dernières bougies (régime de volatilité anormalement calme).
      2. Cassure sur la dernière bougie : clôture au-dessus de bb_upper
         (BUY) ou en-dessous de bb_lower (SELL) -- alors que la bougie
         PRÉCÉDENTE était encore à l'intérieur des bandes (la cassure doit
         être un événement récent, pas un prix déjà loin des bandes depuis
         longtemps).
      3. Volume de la bougie de cassure > sa moyenne mobile
         (SQUEEZE_VOLUME_SMA_PERIOD) : filtre les cassures sans conviction.
    """
    min_points = min_points or (config.SQUEEZE_LOOKBACK + config.SQUEEZE_BB_PERIOD)
    if len(df) < min_points:
        return None

    prev, curr = df.iloc[-2], df.iloc[-1]
    if any(_pd_isna(v) for v in (prev["bb_upper"], prev["bb_lower"], prev["bb_mid"],
                                   curr["bb_upper"], curr["bb_lower"], curr.get("atr"))):
        return None

    band_width = (df["bb_upper"] - df["bb_lower"]) / df["bb_mid"]
    recent_widths = band_width.iloc[-(config.SQUEEZE_LOOKBACK + 1):-1]  # exclut la bougie de cassure elle-même
    if recent_widths.isna().any() or len(recent_widths) < config.SQUEEZE_LOOKBACK:
        return None

    prev_width = band_width.iloc[-2]
    threshold = recent_widths.quantile(config.SQUEEZE_PERCENTILE)
    was_squeezed = prev_width <= threshold
    if not was_squeezed:
        return None

    was_inside = prev["price"] <= prev["bb_upper"] and prev["price"] >= prev["bb_lower"]
    if not was_inside:
        return None

    breakout_up = curr["price"] > curr["bb_upper"]
    breakout_down = curr["price"] < curr["bb_lower"]
    if not (breakout_up or breakout_down):
        return None

    volume_sma = df["volume"].rolling(config.SQUEEZE_VOLUME_SMA_PERIOD).mean().iloc[-1]
    if _pd_isna(volume_sma) or volume_sma <= 0 or curr["volume"] <= volume_sma:
        return None

    side = "BUY" if breakout_up else "SELL"
    return _build_signal(pair, side, curr["price"], curr["atr"])
