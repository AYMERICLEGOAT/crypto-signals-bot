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
    atr, adx/plus_di/minus_di, volume). Retourne un dict signal ou None.

    Condition d'entrée de base :
      1. Compression récente : la largeur de bande relative
         ((bb_upper - bb_lower) / bb_mid) de la bougie précédant la cassure
         était dans le SQUEEZE_PERCENTILE le plus bas des SQUEEZE_LOOKBACK
         bougies qui la précèdent (régime de volatilité anormalement calme).
      2. Cassure : clôture au-dessus de bb_upper (BUY) ou en-dessous de
         bb_lower (SELL) -- alors que la bougie PRÉCÉDENTE était encore à
         l'intérieur des bandes (la cassure doit être un événement récent,
         pas un prix déjà loin des bandes depuis longtemps).
      3. Volume de la bougie de cassure > SQUEEZE_VOLUME_MULTIPLIER x sa
         moyenne mobile (SQUEEZE_VOLUME_SMA_PERIOD) : filtre les cassures
         sans conviction.

    Filtres structurels optionnels (config, neutres par défaut -- voir le
    bloc "Filtres structurels du moteur Squeeze" dans config.py ; toute
    modification ici doit être répercutée à l'identique dans
    backtest_squeeze._squeeze_entry_sides, qui est le code réellement validé) :
      4. SQUEEZE_MIN_BREAKOUT_ATR : dépassement minimal de la bande.
      5. SQUEEZE_ADX_FILTER_MODE : régime de tendance (ADX/+DI/-DI).
      6. SQUEEZE_HTF_EMA_PERIOD : alignement avec la tendance de fond.
      7. SQUEEZE_REQUIRE_CONFIRMATION : la bougie SUIVANT la cassure doit
         elle aussi clôturer hors bande ; l'entrée se fait alors sur cette
         bougie de confirmation (une bougie plus tard, à son cours de
         clôture).
    """
    confirm = 1 if config.SQUEEZE_REQUIRE_CONFIRMATION else 0
    min_points = min_points or (config.SQUEEZE_LOOKBACK + config.SQUEEZE_BB_PERIOD + confirm)
    if len(df) < min_points:
        return None

    # b = position de la bougie de CASSURE (la dernière, ou l'avant-dernière
    # si une bougie de confirmation est exigée) ; l'entrée se fait toujours
    # sur la dernière bougie clôturée.
    b = -1 - confirm
    prev, brk, last = df.iloc[b - 1], df.iloc[b], df.iloc[-1]
    if any(_pd_isna(v) for v in (prev["bb_upper"], prev["bb_lower"], prev["bb_mid"],
                                   brk["bb_upper"], brk["bb_lower"], brk.get("atr"),
                                   last.get("atr"))):
        return None

    band_width = (df["bb_upper"] - df["bb_lower"]) / df["bb_mid"]
    # Les SQUEEZE_LOOKBACK bougies se terminant sur celle qui précède la
    # cassure (exclut la bougie de cassure elle-même).
    recent_widths = band_width.iloc[b - config.SQUEEZE_LOOKBACK:b]
    if recent_widths.isna().any() or len(recent_widths) < config.SQUEEZE_LOOKBACK:
        return None

    prev_width = band_width.iloc[b - 1]
    threshold = recent_widths.quantile(config.SQUEEZE_PERCENTILE)
    was_squeezed = prev_width <= threshold
    if not was_squeezed:
        return None

    was_inside = prev["price"] <= prev["bb_upper"] and prev["price"] >= prev["bb_lower"]
    if not was_inside:
        return None

    breakout_up = brk["price"] > brk["bb_upper"]
    breakout_down = brk["price"] < brk["bb_lower"]
    if not (breakout_up or breakout_down):
        return None

    volume_sma = df["volume"].rolling(config.SQUEEZE_VOLUME_SMA_PERIOD).mean().iloc[b]
    if _pd_isna(volume_sma) or volume_sma <= 0:
        return None
    if brk["volume"] <= config.SQUEEZE_VOLUME_MULTIPLIER * volume_sma:
        return None

    # Filtre 4 : une clôture qui dépasse la bande d'un cheveu n'est pas une
    # cassure, c'est du bruit -- on exige une marge proportionnelle à l'ATR.
    if config.SQUEEZE_MIN_BREAKOUT_ATR > 0:
        margin = config.SQUEEZE_MIN_BREAKOUT_ATR * brk["atr"]
        excess = (brk["price"] - brk["bb_upper"]) if breakout_up else (brk["bb_lower"] - brk["price"])
        if excess < margin:
            return None

    side = "BUY" if breakout_up else "SELL"

    # Filtre 5 : régime de marché (même indicateur que le moteur Haute
    # Confiance, voir config.ENABLE_ADX_REGIME_FILTER / strategy.py).
    mode = config.SQUEEZE_ADX_FILTER_MODE
    if mode != "off":
        adx_val, plus_di, minus_di = brk.get("adx"), brk.get("plus_di"), brk.get("minus_di")
        if any(_pd_isna(v) for v in (adx_val, plus_di, minus_di)):
            if mode == "strict":
                return None
        else:
            trend_up = plus_di > minus_di
            strong = adx_val > config.SQUEEZE_ADX_THRESHOLD
            aligned = trend_up if side == "BUY" else not trend_up
            if mode == "strict" and not (strong and aligned):
                return None
            if mode == "hc" and strong and not aligned:
                return None

    # Filtre 6 : alignement avec la tendance de fond, approximée par une EMA
    # longue sur les mêmes bougies 15m (200 ≈ EMA50 en 1h) -- pas d'appel API
    # supplémentaire, et strictement la même donnée qu'en backtest.
    if config.SQUEEZE_HTF_EMA_PERIOD > 0:
        htf_ema = df["price"].ewm(span=config.SQUEEZE_HTF_EMA_PERIOD, adjust=False).mean().iloc[b]
        if _pd_isna(htf_ema):
            return None
        if side == "BUY" and brk["price"] <= htf_ema:
            return None
        if side == "SELL" and brk["price"] >= htf_ema:
            return None

    # Filtre 7 : confirmation sur la bougie suivante (filtre les mèches
    # isolées qui repassent immédiatement dans la bande).
    if confirm:
        if any(_pd_isna(v) for v in (last["bb_upper"], last["bb_lower"])):
            return None
        if side == "BUY" and not last["price"] > last["bb_upper"]:
            return None
        if side == "SELL" and not last["price"] < last["bb_lower"]:
            return None

    return _build_signal(pair, side, last["price"], last["atr"])
