"""
Calcul des indicateurs techniques avec pandas uniquement (pas de ta-lib,
qui nécessite une compilation C pénible sous Windows).
"""

import pandas as pd


def ema(series: pd.Series, period: int) -> pd.Series:
    """Moyenne mobile exponentielle."""
    return series.ewm(span=period, adjust=False).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """
    RSI (Relative Strength Index) avec lissage de Wilder.
    Retourne des valeurs entre 0 et 100 (NaN tant qu'il n'y a pas assez
    de points pour la période demandée).
    """
    delta = series.diff()
    gains = delta.clip(lower=0)
    losses = -delta.clip(upper=0)

    avg_gain = gains.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = losses.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, pd.NA)
    result = 100 - (100 / (1 + rs))
    # Quand avg_loss == 0 (que des hausses), le RSI vaut 100 par convention.
    result = result.fillna(100)
    return result


def bollinger_bands(series: pd.Series, period: int = 20, num_std: float = 2):
    """Retourne (bande_haute, moyenne_mobile, bande_basse)."""
    mid = series.rolling(period).mean()
    std = series.rolling(period).std()
    upper = mid + num_std * std
    lower = mid - num_std * std
    return upper, mid, lower


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """
    Average True Range (volatilité), lissage de Wilder — même formule que le
    RSI ci-dessus (ewm avec alpha=1/period). Sert aux Alertes Momentum
    (Bloc 3) pour détecter un pic de volatilité, pas à la stratégie de
    signal elle-même.
    """
    prev_close = close.shift(1)
    true_range = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return true_range.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> tuple:
    """MACD standard : (ligne MACD, ligne de signal, histogramme)."""
    macd_line = ema(series, fast) - ema(series, slow)
    signal_line = ema(macd_line, signal)
    histogram = macd_line - signal_line
    return macd_line, signal_line, histogram


def pivot_levels(df: pd.DataFrame, lookback: int = 50, order: int = 5) -> tuple:
    """
    Amélioration 4 : détecte les pivots (plus hauts/plus bas locaux) sur les
    `lookback` dernières bougies. Une bougie i est un pivot haut si son
    "high" est le maximum sur la fenêtre centrée [i-order, i+order] (pivot
    bas : symétrique avec "low"). Retourne (pivot_highs, pivot_lows), deux
    listes de prix — les niveaux de résistance / support candidats.

    Ignore délibérément les `order` dernières bougies : un pivot doit être
    confirmé par des bougies des DEUX côtés, donc les tout derniers points
    ne peuvent pas encore être jugés pivots (pas de triche avec le futur).
    """
    window = df.iloc[-lookback:] if len(df) > lookback else df
    highs, lows = window["high"].reset_index(drop=True), window["low"].reset_index(drop=True)
    n = len(window)

    pivot_highs, pivot_lows = [], []
    for i in range(order, n - order):
        segment_high = highs.iloc[i - order:i + order + 1]
        segment_low = lows.iloc[i - order:i + order + 1]
        if highs.iloc[i] == segment_high.max():
            pivot_highs.append(highs.iloc[i])
        if lows.iloc[i] == segment_low.min():
            pivot_lows.append(lows.iloc[i])
    return pivot_highs, pivot_lows


def nearest_level_distance_pct(price: float, levels: list) -> float | None:
    """Distance relative (valeur absolue, en fraction du prix) au niveau le plus proche, ou None si `levels` est vide."""
    if not levels:
        return None
    return min(abs(price - lvl) for lvl in levels) / price


def compute_all_indicators(df: pd.DataFrame, ema_fast: int, ema_slow: int,
                            rsi_period: int, bb_period: int, bb_std: float,
                            atr_period: int = 14) -> pd.DataFrame:
    """
    Ajoute toutes les colonnes d'indicateurs à un DataFrame contenant
    une colonne 'price'. Retourne une copie enrichie.

    La colonne 'atr' n'est ajoutée que si 'high'/'low' sont présentes : le
    repli CoinGecko (fetch_recent_prices) ne fournit que des prix de clôture,
    auquel cas les Alertes Momentum basées sur l'ATR sont simplement
    ignorées pour cette paire (dégradation silencieuse, pas une erreur).
    """
    out = df.copy()
    out["ema_fast"] = ema(out["price"], ema_fast)
    out["ema_slow"] = ema(out["price"], ema_slow)
    out["rsi"] = rsi(out["price"], rsi_period)
    out["bb_upper"], out["bb_mid"], out["bb_lower"] = bollinger_bands(out["price"], bb_period, bb_std)
    if "high" in out.columns and "low" in out.columns:
        out["atr"] = atr(out["high"], out["low"], out["price"], atr_period)
    return out
