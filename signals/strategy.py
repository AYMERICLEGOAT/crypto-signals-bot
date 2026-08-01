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
    ENABLE_MULTI_TP_EXITS, MULTI_TP_SL_MULTIPLIER,
    MULTI_TP_TP1_MULTIPLIER, MULTI_TP_TP2_MULTIPLIER, MULTI_TP_TP3_MULTIPLIER,
    SIGNAL_CATCHUP_CANDLES, SIGNAL_MAX_DRIFT_TO_TP1,
)


def _build_signal(pair: str, side: str, entry_price: float, timestamp=None, atr: float | None = None) -> dict:
    # Amélioration 3 (validée par backtest, voir config.ENABLE_ATR_STOPS) :
    # SL/TP dynamiques (1.5x/3x ATR14) au lieu de pourcentages fixes, si
    # l'ATR est disponible ; sinon repli sur les pourcentages fixes plutôt
    # que de bloquer le signal (dégradation silencieuse, cohérent avec le
    # reste du module).
    #
    # Mission "grille d'excellence" (validée par backtest, voir
    # config.ENABLE_MULTI_TP_EXITS) : si l'ATR est disponible, la sortie
    # SL/TP unique est remplacée par 3 niveaux (TP1 sécurisation + passage à
    # break-even, TP2 objectif principal, TP3 runner). tp1_price/tp2_price/
    # tp3_price sont ajoutés au signal ; take_profit reste égal à tp2 (les
    # consommateurs existants qui ne connaissent que take_profit continuent
    # de fonctionner sans modification, avec le niveau "objectif principal").
    tp1_price = tp2_price = tp3_price = None
    if ENABLE_ATR_STOPS and atr is not None:
        if ENABLE_MULTI_TP_EXITS:
            stop_dist = MULTI_TP_SL_MULTIPLIER * atr
            tp1_dist = MULTI_TP_TP1_MULTIPLIER * atr
            tp2_dist = MULTI_TP_TP2_MULTIPLIER * atr
            tp3_dist = MULTI_TP_TP3_MULTIPLIER * atr
            if side == "BUY":
                stop_loss = entry_price - stop_dist
                tp1_price, tp2_price, tp3_price = entry_price + tp1_dist, entry_price + tp2_dist, entry_price + tp3_dist
            else:
                stop_loss = entry_price + stop_dist
                tp1_price, tp2_price, tp3_price = entry_price - tp1_dist, entry_price - tp2_dist, entry_price - tp3_dist
            take_profit = tp2_price
        else:
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

    signal = {
        "pair": pair,
        "type": side,
        "entry_price": round(entry_price, 8),
        "stop_loss": round(stop_loss, 8),
        "take_profit": round(take_profit, 8),
        "created_at": (timestamp or datetime.now(timezone.utc)).isoformat(),
        "engine": "high_confidence",
    }
    if tp1_price is not None:
        signal["tp1_price"] = round(tp1_price, 8)
        signal["tp2_price"] = round(tp2_price, 8)
        signal["tp3_price"] = round(tp3_price, 8)
    return signal


def detect_signal(df, pair: str, rsi_buy_threshold: float, rsi_sell_threshold: float,
                   min_points: int = 22, htf_ema50: float | None = None,
                   rsi_window: int = RSI_CROSS_WINDOW, at_index: int | None = None):
    """
    Détecte un croisement EMA confirmé par le RSI n'importe quand dans les
    `rsi_window` dernières bougies (jamais après le croisement : seulement
    des données déjà connues au moment du signal, voir config.RSI_CROSS_WINDOW).

    Par défaut, examine la DERNIÈRE ligne du DataFrame enrichi. `at_index`
    permet d'évaluer une bougie antérieure à la place — indispensable à la
    fenêtre de rattrapage (voir detect_signals_with_catchup) : seules les
    données disponibles jusqu'à cette bougie incluse sont utilisées, donc le
    résultat est strictement identique à ce qu'aurait produit un cycle exécuté
    à l'heure. Aucun regard vers le futur.

    `htf_ema50` (expérimental, voir signals/backtest.py simulate_trades pour
    la validation) : EMA50 4h la plus récente déjà clôturée. Si fourni, un
    signal ACHAT n'est retenu que si le prix est au-dessus, VENTE qu'en
    dessous. None (par défaut) = comportement inchangé.

    Retourne un dict signal ou None si aucune condition n'est remplie.
    """
    if len(df) < min_points:
        return None

    idx = len(df) - 1 if at_index is None else at_index
    if idx < 1 or idx >= len(df):
        return None

    prev, curr = df.iloc[idx - 1], df.iloc[idx]
    if pd_isna(prev["ema_slow"]) or pd_isna(curr["ema_slow"]):
        return None

    crossed_up = prev["price"] <= prev["ema_slow"] and curr["price"] > curr["ema_slow"]
    crossed_down = prev["price"] >= prev["ema_slow"] and curr["price"] < curr["ema_slow"]
    if not (crossed_up or crossed_down):
        return None

    # Fenêtre RSI arrêtée à la bougie évaluée (bornes explicites plutôt qu'un
    # slice négatif : avec at_index, "les rsi_window dernières" ne sont plus
    # forcément les dernières du DataFrame).
    recent_rsi = df["rsi"].iloc[max(0, idx - rsi_window): idx + 1]

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

    signal = _build_signal(pair, side, curr["price"], atr=curr.get("atr"))
    # Horodatage de la bougie d'origine : sert à la déduplication et à
    # mesurer la fraîcheur d'un signal rattrapé (voir is_still_actionable).
    ts_ms = curr.get("ts_ms")
    if ts_ms is not None and not pd_isna(ts_ms):
        signal["candle_ts_ms"] = int(ts_ms)
    return signal


def is_still_actionable(signal: dict, current_price: float) -> bool:
    """
    Un signal rattrapé (détecté sur une bougie déjà ancienne, voir
    detect_signals_with_catchup) ne doit être diffusé que s'il est ENCORE
    prenable au prix actuel. Sans ce garde-fou, rattraper une bougie de
    plusieurs heures reviendrait à annoncer une entrée à un prix que le
    marché a déjà quitté — malhonnête envers l'abonné, et faussement
    flatteur pour les statistiques (le mouvement a déjà eu lieu).

    Rejette si, depuis la bougie d'origine :
      - le stop loss a déjà été franchi (le trade aurait déjà perdu) ;
      - TP1 a déjà été atteint (le gain facile est passé) ;
      - le prix a parcouru plus de MAX_DRIFT_TO_TP1 de la distance vers TP1
        (le rapport risque/rendement restant s'est trop dégradé).
    """
    entry = signal["entry_price"]
    stop = signal["stop_loss"]
    tp1 = signal.get("tp1_price") or signal["take_profit"]
    if current_price <= 0:
        return False

    if signal["type"] == "BUY":
        if current_price <= stop or current_price >= tp1:
            return False
        progressed = (current_price - entry) / (tp1 - entry) if tp1 > entry else 1.0
    else:
        if current_price >= stop or current_price <= tp1:
            return False
        progressed = (entry - current_price) / (entry - tp1) if entry > tp1 else 1.0

    return progressed <= SIGNAL_MAX_DRIFT_TO_TP1


def detect_signals_with_catchup(df, pair: str, rsi_buy_threshold: float, rsi_sell_threshold: float,
                                 lookback_candles: int = SIGNAL_CATCHUP_CANDLES,
                                 htf_ema50: float | None = None,
                                 rsi_window: int = RSI_CROSS_WINDOW) -> list[dict]:
    """
    Corrige la perte définitive de signaux constatée en production (audit du
    01/08/2026). detect_signal() n'examinait QUE la dernière bougie close :
    or le cron GitHub Actions ne se déclenche en pratique qu'environ 12 fois
    par jour au lieu de 24 (déclenchements planifiés retardés ou sautés,
    mesuré sur l'historique des exécutions). Chaque bougie non évaluée
    emportait ses croisements avec elle, sans rattrapage possible — mesuré :
    ~10 signaux attendus sur 7 jours, 0 réellement émis.

    Balaie donc les `lookback_candles` dernières bougies closes, de la plus
    ancienne à la plus récente, et retourne TOUS les signaux trouvés (l'appelant
    déduplique et filtre par fraîcheur, voir is_still_actionable). Un cycle
    manqué est ainsi rattrapé au cycle suivant au lieu d'être perdu.
    """
    if len(df) < 2:
        return []

    last = len(df) - 1
    first = max(1, last - lookback_candles + 1)
    found = []
    for idx in range(first, last + 1):
        signal = detect_signal(
            df, pair, rsi_buy_threshold, rsi_sell_threshold,
            htf_ema50=htf_ema50, rsi_window=rsi_window, at_index=idx,
        )
        if signal:
            found.append(signal)
    return found


def pd_isna(value) -> bool:
    """Petit alias local pour éviter d'importer pandas juste pour isna()."""
    import pandas as pd
    return pd.isna(value)
