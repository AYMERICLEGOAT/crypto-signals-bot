"""
Backtest combiné des DEUX moteurs de signaux tournant en parallèle et
partageant le même verrou de portefeuille (MAX_ACTIVE_TRADES, voir
config.py) que la production :
  - 🎯 Haute Confiance (EMA/RSI 1h, voir strategy.py) — inchangé.
  - ⚡ Squeeze Volatilité 15M (voir squeeze_engine.py) — nouveau.

Simulation événementielle sur l'union des timestamps des deux résolutions
(1h et 15m) et des 40 paires de config.PAIRS, dans l'ordre chronologique,
avec un seul pool de slots partagé entre les deux moteurs -- reproduit
fidèlement la contrainte réelle de production (storage.count_open_at_risk_trades
compte tous les signaux ouverts, peu importe leur moteur d'origine).

Objectif de validation (demande explicite) : sur 12 mois,
  - au moins 2 à 3 signaux/jour cumulés,
  - win rate TP1 > 55%,
  - drawdown max < 45%.

Usage : python backtest_squeeze.py
"""

import json
import logging
import os

import numpy as np
import pandas as pd

import config
import binance_client
from indicators import compute_all_indicators
from backtest import (
    filter_correlated_trades, win_rate_of, gain_loss_ratio_of,
    max_drawdown_of, WARMUP_CANDLES,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BACKTEST_PAIRS = list(config.PAIRS.keys())
VALIDATION_DAYS = 365  # 12 mois, demande explicite (distinct du 24 mois par défaut ailleurs)
SQUEEZE_INTERVAL = "15m"
HC_TIMEOUT_PERIODS = config.BACKTEST_TRADE_TIMEOUT_DAYS * 24        # 1h
SQUEEZE_TIMEOUT_PERIODS = config.BACKTEST_TRADE_TIMEOUT_DAYS * 96   # 15m (4x plus de bougies/jour)

# Cache disque local : ce backtest télécharge 40 paires x 2 résolutions x 12
# mois (~35k bougies/paire en 15m) -- plusieurs dizaines de minutes sur le
# réseau Binance. Un timeout transitoire sur UNE paire ne doit pas obliger à
# tout retélécharger depuis zéro. Recherche pure (voir signals/backtest.py
# pour le pendant sans cache, utilisé pour le tuning officiel des paramètres
# en production) -- jamais lu par main.py.
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "backtest_cache")


def _cached_klines(cache_key: str, fetch_fn):
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_path = os.path.join(CACHE_DIR, f"{cache_key}.json")
    if os.path.exists(cache_path):
        with open(cache_path, "r", encoding="utf-8") as f:
            return json.load(f)
    candles = fetch_fn()
    if candles:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(candles, f)
    return candles


def fetch_all_klines_cached(pairs=BACKTEST_PAIRS, days=VALIDATION_DAYS) -> dict:
    """Équivalent de backtest.fetch_all_klines (bougies 1h), avec cache disque (voir _cached_klines)."""
    pair_dfs = {}
    for pair in pairs:
        symbol = binance_client.pair_to_symbol(pair)
        cache_key = f"{symbol}_1h_{days}d"
        logger.info("Bougies 1h %s (%s, %d jours)...", pair, symbol, days)
        candles = _cached_klines(cache_key, lambda: binance_client.get_historical_klines(symbol, interval="1h", days=days))
        if not candles:
            logger.warning("Aucune donnée Binance 1h pour %s, ignoré.", pair)
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
        pair_dfs[pair] = df
        logger.info("%s: %d bougies 1h (cache ou téléchargement).", pair, len(df))
    return pair_dfs


def fetch_15m_klines(pairs=BACKTEST_PAIRS, days=VALIDATION_DAYS) -> dict:
    """Historique 15 minutes Binance pour chaque paire (utilisé uniquement pour ce backtest local, hors production), avec cache disque."""
    pair_dfs = {}
    for pair in pairs:
        symbol = binance_client.pair_to_symbol(pair)
        cache_key = f"{symbol}_15m_{days}d"
        logger.info("Bougies 15m %s (%s, %d jours)...", pair, symbol, days)
        candles = _cached_klines(cache_key, lambda: binance_client.get_historical_klines(symbol, interval=SQUEEZE_INTERVAL, days=days))
        if not candles:
            logger.warning("Aucune donnée Binance 15m pour %s, ignoré.", pair)
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
        pair_dfs[pair] = df
        logger.info("%s: %d bougies 15m téléchargées.", pair, len(df))
    return pair_dfs


# --- Détection d'entrée vectorisée -------------------------------------------
# La boucle événementielle testait les conditions d'entrée bougie par bougie
# via .iloc (jusqu'à ~2,8 M extractions de ligne pandas par backtest, soit
# plusieurs minutes à elle seule). Les conditions ne dépendant que de la série
# de la paire, elles sont précalculées ici en une passe numpy par paire :
# résultat strictement identique, temps négligeable.

def _lag_float(a: np.ndarray, k: int) -> np.ndarray:
    """Valeur de `a` k bougies plus tôt, réalignée sur l'index courant (NaN en tête)."""
    if k == 0:
        return a
    out = np.full(a.shape, np.nan)
    out[k:] = a[:-k]
    return out


def _lag_bool(a: np.ndarray, k: int) -> np.ndarray:
    if k == 0:
        return a
    out = np.zeros(a.shape, dtype=bool)
    out[k:] = a[:-k]
    return out


def _squeeze_entry_sides(e: pd.DataFrame) -> np.ndarray:
    """
    Vectorise EXACTEMENT squeeze_engine.detect_squeeze_signal (détection de
    base + filtres structurels de config) sur toute la série 15m d'une paire.
    Retourne un tableau int8 aligné sur l'index de `e` : +1 = ouvrir un BUY
    sur cette bougie (à sa clôture), -1 = SELL, 0 = rien.

    ⚠️ Toute évolution de la logique doit être faite dans les DEUX fichiers,
    sinon ce qui est validé ici n'est pas ce qui tourne en production.
    """
    price = e["price"].to_numpy(dtype=float)
    bbu = e["bb_upper"].to_numpy(dtype=float)
    bbl = e["bb_lower"].to_numpy(dtype=float)
    bbm = e["bb_mid"].to_numpy(dtype=float)
    atr = e["atr"].to_numpy(dtype=float)
    vol = e["volume"].to_numpy(dtype=float)
    vsma = e["volume_sma"].to_numpy(dtype=float)
    bw = e["band_width"].to_numpy(dtype=float)
    thr = e["squeeze_threshold"].to_numpy(dtype=float)

    with np.errstate(invalid="ignore"):
        prev_price, prev_bbu, prev_bbl, prev_bbm = (_lag_float(x, 1) for x in (price, bbu, bbl, bbm))
        prev_ok = ~(np.isnan(prev_bbu) | np.isnan(prev_bbl) | np.isnan(prev_bbm))
        squeezed = _lag_float(bw, 1) <= _lag_float(thr, 1)
        inside = (prev_price <= prev_bbu) & (prev_price >= prev_bbl)
        vol_ok = (vsma > 0) & (vol > config.SQUEEZE_VOLUME_MULTIPLIER * vsma)
        base = prev_ok & squeezed & inside & vol_ok & ~np.isnan(atr)

        buy = base & (price > bbu)
        sell = base & (price < bbl)

        margin = config.SQUEEZE_MIN_BREAKOUT_ATR
        if margin > 0:
            buy &= (price - bbu) >= margin * atr
            sell &= (bbl - price) >= margin * atr

        mode = config.SQUEEZE_ADX_FILTER_MODE
        if mode != "off" and "adx" in e.columns:
            adx = e["adx"].to_numpy(dtype=float)
            pdi = e["plus_di"].to_numpy(dtype=float)
            mdi = e["minus_di"].to_numpy(dtype=float)
            known = ~(np.isnan(adx) | np.isnan(pdi) | np.isnan(mdi))
            strong = known & (adx > config.SQUEEZE_ADX_THRESHOLD)
            up_trend = pdi > mdi
            if mode == "strict":
                buy &= strong & up_trend
                sell &= strong & ~up_trend
            else:  # "hc" : ne rejette que les cassures à contre-tendance en régime de tendance forte
                buy &= ~(strong & ~up_trend)
                sell &= ~(strong & up_trend)

        if config.SQUEEZE_HTF_EMA_PERIOD > 0:
            htf = e["price"].ewm(span=config.SQUEEZE_HTF_EMA_PERIOD, adjust=False).mean().to_numpy(dtype=float)
            buy &= price > htf
            sell &= price < htf

        if config.SQUEEZE_REQUIRE_CONFIRMATION:
            # L'entrée glisse sur la bougie suivante, qui doit elle aussi
            # clôturer hors bande (et fournir un ATR exploitable).
            buy = _lag_bool(buy, 1) & (price > bbu) & ~np.isnan(atr)
            sell = _lag_bool(sell, 1) & (price < bbl) & ~np.isnan(atr)

    return np.where(buy, 1, np.where(sell, -1, 0)).astype(np.int8)


def _hc_entry_sides(e: pd.DataFrame) -> np.ndarray:
    """
    Vectorise la condition d'entrée du moteur 🎯 Haute Confiance (croisement
    prix/EMA lente + RSI en zone extrême sur la fenêtre RSI_CROSS_WINDOW +
    filtre de régime ADX), à l'identique de strategy.detect_signal /
    backtest.simulate_trades. Moteur en production : logique inchangée, seule
    la forme (numpy au lieu de .iloc bougie par bougie) diffère.
    """
    price = e["price"].to_numpy(dtype=float)
    ema_slow = e["ema_slow"].to_numpy(dtype=float)
    rsi = e["rsi"].to_numpy(dtype=float)
    atr = e["atr"].to_numpy(dtype=float)
    window = config.RSI_CROSS_WINDOW + 1
    rsi_min = e["rsi"].rolling(window, min_periods=1).min().to_numpy(dtype=float)
    rsi_max = e["rsi"].rolling(window, min_periods=1).max().to_numpy(dtype=float)

    with np.errstate(invalid="ignore"):
        known = ~(np.isnan(ema_slow) | np.isnan(rsi) | np.isnan(atr)) & (atr > 0)
        crossed_up = (_lag_float(price, 1) <= _lag_float(ema_slow, 1)) & (price > ema_slow)
        crossed_down = (_lag_float(price, 1) >= _lag_float(ema_slow, 1)) & (price < ema_slow)
        buy = known & crossed_up & (rsi_min < config.RSI_BUY_THRESHOLD)
        sell = known & crossed_down & (rsi_max > config.RSI_SELL_THRESHOLD)

        if config.ENABLE_ADX_REGIME_FILTER and "adx" in e.columns:
            adx = e["adx"].to_numpy(dtype=float)
            pdi = e["plus_di"].to_numpy(dtype=float)
            mdi = e["minus_di"].to_numpy(dtype=float)
            strong = ~np.isnan(adx) & (adx > config.ADX_TREND_THRESHOLD)
            up_trend = pdi > mdi
            buy &= ~(strong & ~up_trend)
            sell &= ~(strong & up_trend)

    return np.where(buy, 1, np.where(sell, -1, 0)).astype(np.int8)


def _ohlc_arrays(enriched: dict) -> dict:
    """Colonnes utiles à la gestion des sorties, en numpy (évite un .iloc par bougie et par position ouverte)."""
    return {
        pair: {
            "low": e["low"].to_numpy(dtype=float),
            "high": e["high"].to_numpy(dtype=float),
            "price": e["price"].to_numpy(dtype=float),
            "atr": e["atr"].to_numpy(dtype=float),
            "ts_ms": e["ts_ms"].to_numpy(),
        }
        for pair, e in enriched.items()
    }


def simulate_combined_portfolio(hc_dfs: dict, squeeze_dfs: dict, max_active_trades: int) -> list:
    """
    Simulation événementielle combinée : union des timestamps 1h (Haute
    Confiance) et 15m (Squeeze) sur toutes les paires, un seul pool de
    MAX_ACTIVE_TRADES slots partagé. Retourne la liste des trades fermés
    (même format que backtest.simulate_portfolio_capped, avec un champ
    "engine" en plus).
    """
    hc_enriched = {
        pair: compute_all_indicators(
            df, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
            config.RSI_PERIOD, config.BOLLINGER_PERIOD, config.BOLLINGER_STD,
        ).reset_index(drop=True)
        for pair, df in hc_dfs.items()
    }
    squeeze_enriched = {
        pair: compute_all_indicators(
            df, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
            config.RSI_PERIOD, config.SQUEEZE_BB_PERIOD, config.SQUEEZE_BB_STD,
        ).reset_index(drop=True)
        for pair, df in squeeze_dfs.items()
    }
    # Perf : le seuil de compression (quantile glissant de la largeur de
    # bande) était recalculé à la volée pour CHAQUE candidat d'entrée
    # (jusqu'à 40 paires x ~35 000 bougies 15m = ~1.4M tris O(n log n) sur
    # une fenêtre de 96 -- plusieurs dizaines de minutes). Précalculé ici en
    # vectorisé (une seule passe .rolling par paire), même résultat, des
    # ordres de grandeur plus rapide.
    for e in squeeze_enriched.values():
        e["band_width"] = (e["bb_upper"] - e["bb_lower"]) / e["bb_mid"]
        e["squeeze_threshold"] = e["band_width"].rolling(config.SQUEEZE_LOOKBACK).quantile(config.SQUEEZE_PERCENTILE)
        e["volume_sma"] = e["volume"].rolling(config.SQUEEZE_VOLUME_SMA_PERIOD).mean()

    hc_sides = {pair: _hc_entry_sides(e) for pair, e in hc_enriched.items()}
    squeeze_sides = {pair: _squeeze_entry_sides(e) for pair, e in squeeze_enriched.items()}
    hc_arr, squeeze_arr = _ohlc_arrays(hc_enriched), _ohlc_arrays(squeeze_enriched)

    squeeze_min_idx = max(WARMUP_CANDLES, config.SQUEEZE_LOOKBACK + config.SQUEEZE_BB_PERIOD)

    def ts_index(enriched):
        return {pair: {ts: i for i, ts in enumerate(e["ts_ms"].values)} for pair, e in enriched.items()}

    hc_idx, squeeze_idx = ts_index(hc_enriched), ts_index(squeeze_enriched)
    all_ts = sorted(
        set().union(*[set(e["ts_ms"].values) for e in hc_enriched.values()],
                     *[set(e["ts_ms"].values) for e in squeeze_enriched.values()])
    )

    open_positions: dict = {}  # clé (pair, engine)
    closed_trades: list = []
    n_active_pre_tp1 = 0

    def ret(side, entry, level):
        return (level - entry) / entry if side == "BUY" else (entry - level) / entry

    def process_exits(pair, engine, arr_map, idx_map, ts):
        nonlocal n_active_pre_tp1
        key = (pair, engine)
        if key not in open_positions:
            return
        idx = idx_map[pair].get(ts)
        if idx is None:
            return
        pos = open_positions[key]
        arr = arr_map[pair]
        lo, hi, side = arr["low"][idx], arr["high"][idx], pos["side"]
        hit_stop = (lo <= pos["stop"]) if side == "BUY" else (hi >= pos["stop"])

        def _close(outcome, exit_price):
            closed_trades.append({
                "pair": pair, "side": side, "entry_price": pos["entry_price"], "exit_price": exit_price,
                "outcome": outcome, "pnl_pct": pos["pnl_pct_acc"],
                "entered_at": pos["entered_at"], "exited_at": int(arr["ts_ms"][idx]),
                "tp1_hit": pos["tp1_hit"], "engine": engine,
            })
            del open_positions[key]

        if not pos["tp1_hit"]:
            hit_tp1 = (hi >= pos["tp1"]) if side == "BUY" else (lo <= pos["tp1"])
            if hit_stop:
                pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], pos["stop"])
                _close("LOSS", pos["stop"])
                n_active_pre_tp1 -= 1
                return
            if hit_tp1:
                pos["pnl_pct_acc"] += pos["tp1_weight"] * ret(side, pos["entry_price"], pos["tp1"])
                pos["weight_remaining"] -= pos["tp1_weight"]
                pos["tp1_hit"], pos["stop"] = True, pos["entry_price"]
                n_active_pre_tp1 -= 1
                hit_tp2 = (hi >= pos["tp2"]) if side == "BUY" else (lo <= pos["tp2"])
                if hit_tp2:
                    pos["pnl_pct_acc"] += pos["tp2_weight"] * ret(side, pos["entry_price"], pos["tp2"])
                    pos["weight_remaining"] -= pos["tp2_weight"]
                    pos["tp2_hit"] = True
                    hit_tp3 = (hi >= pos["tp3"]) if side == "BUY" else (lo <= pos["tp3"])
                    if hit_tp3:
                        pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], pos["tp3"])
                        _close("WIN", pos["tp3"])
                return
        else:
            if not pos["tp2_hit"]:
                hit_tp2 = (hi >= pos["tp2"]) if side == "BUY" else (lo <= pos["tp2"])
                if hit_stop:
                    pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], pos["stop"])
                    _close("WIN", pos["stop"])
                    return
                if hit_tp2:
                    pos["pnl_pct_acc"] += pos["tp2_weight"] * ret(side, pos["entry_price"], pos["tp2"])
                    pos["weight_remaining"] -= pos["tp2_weight"]
                    pos["tp2_hit"] = True
                    hit_tp3 = (hi >= pos["tp3"]) if side == "BUY" else (lo <= pos["tp3"])
                    if hit_tp3:
                        pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], pos["tp3"])
                        _close("WIN", pos["tp3"])
            else:
                hit_tp3 = (hi >= pos["tp3"]) if side == "BUY" else (lo <= pos["tp3"])
                if hit_stop:
                    pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], pos["stop"])
                    _close("WIN", pos["stop"])
                    return
                if hit_tp3:
                    pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], pos["tp3"])
                    _close("WIN", pos["tp3"])

        if key in open_positions:
            timeout = HC_TIMEOUT_PERIODS if engine == "high_confidence" else SQUEEZE_TIMEOUT_PERIODS
            held = idx - pos["entry_idx"]
            if held >= timeout:
                exit_price = arr["price"][idx]
                pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], exit_price)
                outcome = "WIN" if pos["tp1_hit"] else "TIMEOUT"
                if not pos["tp1_hit"]:
                    n_active_pre_tp1 -= 1
                _close(outcome, exit_price)

    def _open(pair, engine, side, idx, arr, sl_mult, tp1_mult, tp2_mult, tp3_mult, tp1_w, tp2_w):
        nonlocal n_active_pre_tp1
        atr_val, entry_price = arr["atr"][idx], arr["price"][idx]
        sl_dist = sl_mult * atr_val
        if side == "BUY":
            stop = entry_price - sl_dist
            tp1, tp2, tp3 = (entry_price + tp1_mult * atr_val, entry_price + tp2_mult * atr_val,
                             entry_price + tp3_mult * atr_val)
        else:
            stop = entry_price + sl_dist
            tp1, tp2, tp3 = (entry_price - tp1_mult * atr_val, entry_price - tp2_mult * atr_val,
                             entry_price - tp3_mult * atr_val)
        open_positions[(pair, engine)] = {
            "side": side, "entry_price": entry_price, "entry_idx": idx, "stop": stop,
            "tp1": tp1, "tp2": tp2, "tp3": tp3, "tp1_hit": False, "tp2_hit": False,
            "weight_remaining": 1.0, "pnl_pct_acc": 0.0, "entered_at": int(arr["ts_ms"][idx]),
            "tp1_weight": tp1_w, "tp2_weight": tp2_w,
        }
        n_active_pre_tp1 += 1

    def try_enter_hc(pair, ts):
        if (pair, "high_confidence") in open_positions:
            return
        idx = hc_idx[pair].get(ts)
        n = len(hc_sides[pair])
        if idx is None or idx < WARMUP_CANDLES or idx >= n - 1:
            return
        code = hc_sides[pair][idx]
        if code == 0:
            return
        _open(pair, "high_confidence", "BUY" if code > 0 else "SELL", idx, hc_arr[pair],
              config.MULTI_TP_SL_MULTIPLIER, config.MULTI_TP_TP1_MULTIPLIER,
              config.MULTI_TP_TP2_MULTIPLIER, config.MULTI_TP_TP3_MULTIPLIER,
              config.MULTI_TP_TP1_WEIGHT, config.MULTI_TP_TP2_WEIGHT)

    def try_enter_squeeze(pair, ts):
        if (pair, "squeeze_15m") in open_positions:
            return
        idx = squeeze_idx[pair].get(ts)
        n = len(squeeze_sides[pair])
        if idx is None or idx < squeeze_min_idx or idx >= n - 1:
            return
        code = squeeze_sides[pair][idx]
        if code == 0:
            return
        _open(pair, "squeeze_15m", "BUY" if code > 0 else "SELL", idx, squeeze_arr[pair],
              config.SQUEEZE_SL_MULTIPLIER, config.SQUEEZE_TP1_MULTIPLIER,
              config.SQUEEZE_TP2_MULTIPLIER, config.SQUEEZE_TP3_MULTIPLIER,
              config.SQUEEZE_TP1_WEIGHT, config.SQUEEZE_TP2_WEIGHT)

    for ts in all_ts:
        for pair in list(hc_enriched.keys()):
            process_exits(pair, "high_confidence", hc_arr, hc_idx, ts)
        for pair in list(squeeze_enriched.keys()):
            process_exits(pair, "squeeze_15m", squeeze_arr, squeeze_idx, ts)

        if n_active_pre_tp1 >= max_active_trades:
            continue
        for pair in hc_enriched:
            if n_active_pre_tp1 >= max_active_trades:
                break
            try_enter_hc(pair, ts)
        for pair in squeeze_enriched:
            if n_active_pre_tp1 >= max_active_trades:
                break
            try_enter_squeeze(pair, ts)

    return closed_trades


def expectancy_of(trades: list) -> float:
    """
    Espérance par trade, en pourcentage du capital engagé (moyenne simple des
    pnl_pct réalisés). C'est LE chiffre qui décide si un moteur mérite de
    tourner : un win rate élevé avec un ratio gain/perte faible peut très bien
    donner une espérance négative (cas historique du moteur Squeeze).
    """
    if not trades:
        return 0.0
    return sum(t["pnl_pct"] for t in trades) / len(trades)


def report(trades: list, days: int = VALIDATION_DAYS) -> None:
    hc_trades = [t for t in trades if t["engine"] == "high_confidence"]
    sq_trades = [t for t in trades if t["engine"] == "squeeze_15m"]

    for label, subset in [("🎯 Haute Confiance seul", hc_trades), ("⚡ Squeeze 15M seul", sq_trades), ("COMBINÉ", trades)]:
        gl = gain_loss_ratio_of(subset)
        logger.info(
            "%s -> %d trades (%.2f/jour), win rate TP1 = %.1f%%, ratio gain/perte = %s, "
            "espérance/trade = %+.4f%%, drawdown max = %.1f%%",
            label, len(subset), len(subset) / days, win_rate_of(subset) * 100,
            f"{gl:.2f}" if gl else "n/a", expectancy_of(subset) * 100, max_drawdown_of(subset),
        )


def main():
    logger.info("=== Backtest combiné Haute Confiance (1h) + Squeeze Volatilité (15m), %d paires, %d jours ===",
                len(BACKTEST_PAIRS), VALIDATION_DAYS)

    hc_dfs = fetch_all_klines_cached(pairs=BACKTEST_PAIRS, days=VALIDATION_DAYS)
    squeeze_dfs = fetch_15m_klines(pairs=BACKTEST_PAIRS, days=VALIDATION_DAYS)

    trades = simulate_combined_portfolio(hc_dfs, squeeze_dfs, max_active_trades=config.MAX_ACTIVE_TRADES)
    trades = filter_correlated_trades(trades, total_pairs=len(BACKTEST_PAIRS))

    report(trades)

    combined_wr = win_rate_of(trades) * 100
    combined_dd = max_drawdown_of(trades)
    combined_per_day = len(trades) / VALIDATION_DAYS
    logger.info("=== Validation des critères demandés ===")
    logger.info("Signaux/jour cumulés : %.2f (cible 2-3) -> %s", combined_per_day,
                "OK" if 2 <= combined_per_day else "INSUFFISANT")
    logger.info("Win rate TP1 combiné : %.1f%% (cible > 55%%) -> %s", combined_wr,
                "OK" if combined_wr > 55 else "INSUFFISANT")
    logger.info("Drawdown max combiné : %.1f%% (cible < 45%%) -> %s", combined_dd,
                "OK" if combined_dd < 45 else "INSUFFISANT")


if __name__ == "__main__":
    main()
