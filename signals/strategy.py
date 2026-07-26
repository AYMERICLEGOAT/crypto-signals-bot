"""
Logique de la stratégie de trading :
  - Signal ACHAT : le prix croise l'EMA lente à la hausse ET RSI < seuil bas
    à un moment ou un autre des RSI_CROSS_WINDOW dernières bougies (voir
    config.py : exiger la coïncidence sur la bougie EXACTE du croisement ne
    se produit quasiment jamais, le RSI étant plus réactif que l'EMA lente).
  - Signal VENTE : le prix croise l'EMA lente à la baisse ET RSI > seuil haut
    dans la même fenêtre récente.

Le stop loss / take profit sont exprimés en pourcentage du prix d'entrée,
dans le sens cohérent avec la direction du signal (pour une VENTE/short,
le stop est au-dessus et le take profit en dessous).
"""

from datetime import datetime, timezone

from config import (
    STOP_LOSS_PCT, TAKE_PROFIT_PCT, RSI_CROSS_WINDOW,
    ENABLE_ATR_STOPS, ATR_STOP_MULTIPLIER, ATR_TARGET_MULTIPLIER,
    ENABLE_ADX_REGIME_FILTER, ADX_TREND_THRESHOLD,
)


def _build_signal(pair: str, side: str, entry_price: float, timestamp=None, atr: float | None = None) -> dict:
    # Amélioration 3 (validée par backtest, voir config.ENABLE_ATR_STOPS) :
    # SL/TP dynamiques (1.5x/3x ATR14) au lieu de pourcentages fixes, si
    # l'ATR est disponible ; sinon repli sur les pourcentages fixes plutôt
    # que de bloquer le signal (dégradation silencieuse, cohérent avec le
    # reste du module).
    if ENABLE_ATR_STOPS and atr is not None:
        stop_dist = ATR_STOP_MULTIPLIER * atr
        target_dist = ATR_TARGET_MULTIPLIER * atr
        if side == "BUY":
            stop_loss = entry_price - stop_dist
            take_profit = entry_price + target_dist
        else:
            stop_loss = entry_price + stop_dist
            take_profit = entry_price - target_dist
    elif side == "BUY":
        stop_loss = entry_price * (1 - STOP_LOSS_PCT)
        take_profit = entry_price * (1 + TAKE_PROFIT_PCT)
    else:  # SELL
        stop_loss = entry_price * (1 + STOP_LOSS_PCT)
        take_profit = entry_price * (1 - TAKE_PROFIT_PCT)

    return {
        "pair": pair,
        "type": side,
        "entry_price": round(entry_price, 8),
        "stop_loss": round(stop_loss, 8),
        "take_profit": round(take_profit, 8),
        "created_at": (timestamp or datetime.now(timezone.utc)).isoformat(),
    }


def detect_signal(df, pair: str, rsi_buy_threshold: float, rsi_sell_threshold: float,
                   min_points: int = 22, htf_ema50: float | None = None,
                   rsi_window: int = RSI_CROSS_WINDOW):
    """
    Regarde la dernière ligne d'un DataFrame déjà enrichi par
    compute_all_indicators() (colonnes: price, ema_slow, rsi) et détecte
    un croisement EMA, confirmé par le RSI n'importe quand dans les
    `rsi_window` dernières bougies (jamais après le croisement : seulement
    des données déjà connues au moment du signal, voir config.RSI_CROSS_WINDOW).

    `htf_ema50` (expérimental, voir signals/backtest.py simulate_trades pour
    la validation) : EMA50 4h la plus récente déjà clôturée. Si fourni, un
    signal ACHAT n'est retenu que si le prix est au-dessus, VENTE qu'en
    dessous. None (par défaut) = comportement inchangé.

    Retourne un dict signal ou None si aucune condition n'est remplie.
    """
    if len(df) < min_points:
        return None

    prev, curr = df.iloc[-2], df.iloc[-1]
    if pd_isna(prev["ema_slow"]) or pd_isna(curr["ema_slow"]):
        return None

    crossed_up = prev["price"] <= prev["ema_slow"] and curr["price"] > curr["ema_slow"]
    crossed_down = prev["price"] >= prev["ema_slow"] and curr["price"] < curr["ema_slow"]
    if not (crossed_up or crossed_down):
        return None

    recent_rsi = df["rsi"].iloc[-(rsi_window + 1):]

    side = None
    if crossed_up and (recent_rsi < rsi_buy_threshold).any():
        side = "BUY"
    elif crossed_down and (recent_rsi > rsi_sell_threshold).any():
        side = "SELL"
    if side is None:
        return None

    # Piste 3 (validée par backtest, voir config.ENABLE_ADX_REGIME_FILTER) :
    # en tendance forte confirmée (ADX > seuil), un signal à contre-tendance
    # (+DI/-DI) est écarté plutôt que pris malgré tout.
    if ENABLE_ADX_REGIME_FILTER:
        adx_val = curr.get("adx")
        if pd_isna(adx_val):
            return None
        if adx_val > ADX_TREND_THRESHOLD:
            trend_up = curr["plus_di"] > curr["minus_di"]
            if side == "BUY" and not trend_up:
                return None
            if side == "SELL" and trend_up:
                return None

    if htf_ema50 is not None:
        if side == "BUY" and not (curr["price"] > htf_ema50):
            return None
        if side == "SELL" and not (curr["price"] < htf_ema50):
            return None

    return _build_signal(pair, side, curr["price"], atr=curr.get("atr"))


def pd_isna(value) -> bool:
    """Petit alias local pour éviter d'importer pandas juste pour isna()."""
    import pandas as pd
    return pd.isna(value)
