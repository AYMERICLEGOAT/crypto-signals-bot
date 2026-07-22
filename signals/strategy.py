"""
Logique de la stratégie de trading :
  - Signal ACHAT : le prix croise l'EMA lente à la hausse ET RSI < seuil bas.
  - Signal VENTE : le prix croise l'EMA lente à la baisse ET RSI > seuil haut.

Le stop loss / take profit sont exprimés en pourcentage du prix d'entrée,
dans le sens cohérent avec la direction du signal (pour une VENTE/short,
le stop est au-dessus et le take profit en dessous).
"""

from datetime import datetime, timezone

from config import STOP_LOSS_PCT, TAKE_PROFIT_PCT


def _build_signal(pair: str, side: str, entry_price: float, timestamp=None) -> dict:
    if side == "BUY":
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
                   min_points: int = 22):
    """
    Regarde les deux dernières lignes d'un DataFrame déjà enrichi par
    compute_all_indicators() (colonnes: price, ema_slow, rsi) et détecte
    un croisement EMA + confirmation RSI.

    Retourne un dict signal ou None si aucune condition n'est remplie.
    """
    if len(df) < min_points:
        return None

    prev, curr = df.iloc[-2], df.iloc[-1]
    if pd_isna(prev["ema_slow"]) or pd_isna(curr["ema_slow"]) or pd_isna(curr["rsi"]):
        return None

    crossed_up = prev["price"] <= prev["ema_slow"] and curr["price"] > curr["ema_slow"]
    crossed_down = prev["price"] >= prev["ema_slow"] and curr["price"] < curr["ema_slow"]

    if crossed_up and curr["rsi"] < rsi_buy_threshold:
        return _build_signal(pair, "BUY", curr["price"])

    if crossed_down and curr["rsi"] > rsi_sell_threshold:
        return _build_signal(pair, "SELL", curr["price"])

    return None


def pd_isna(value) -> bool:
    """Petit alias local pour éviter d'importer pandas juste pour isna()."""
    import pandas as pd
    return pd.isna(value)
