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

    def process_exits(pair, engine, enriched_map, idx_map, ts):
        nonlocal n_active_pre_tp1
        key = (pair, engine)
        if key not in open_positions:
            return
        idx = idx_map[pair].get(ts)
        if idx is None:
            return
        pos = open_positions[key]
        candle = enriched_map[pair].iloc[idx]
        lo, hi, side = candle["low"], candle["high"], pos["side"]
        hit_stop = (lo <= pos["stop"]) if side == "BUY" else (hi >= pos["stop"])

        def _close(outcome, exit_price):
            closed_trades.append({
                "pair": pair, "side": side, "entry_price": pos["entry_price"], "exit_price": exit_price,
                "outcome": outcome, "pnl_pct": pos["pnl_pct_acc"],
                "entered_at": pos["entered_at"], "exited_at": int(candle["ts_ms"]),
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
                exit_price = candle["price"]
                pos["pnl_pct_acc"] += pos["weight_remaining"] * ret(side, pos["entry_price"], exit_price)
                outcome = "WIN" if pos["tp1_hit"] else "TIMEOUT"
                if not pos["tp1_hit"]:
                    n_active_pre_tp1 -= 1
                _close(outcome, exit_price)

    def try_enter_hc(pair, ts):
        nonlocal n_active_pre_tp1
        key = (pair, "high_confidence")
        if key in open_positions:
            return
        e = hc_enriched[pair]
        idx = hc_idx[pair].get(ts)
        if idx is None or idx < WARMUP_CANDLES or idx >= len(e) - 1:
            return
        prev, curr = e.iloc[idx - 1], e.iloc[idx]
        if pd.isna(curr["ema_slow"]) or pd.isna(curr["rsi"]) or pd.isna(curr.get("atr")):
            return
        crossed_up = prev["price"] <= prev["ema_slow"] and curr["price"] > curr["ema_slow"]
        crossed_down = prev["price"] >= prev["ema_slow"] and curr["price"] < curr["ema_slow"]
        recent_rsi = e["rsi"].iloc[max(0, idx - config.RSI_CROSS_WINDOW):idx + 1]
        side = None
        if crossed_up and (recent_rsi < config.RSI_BUY_THRESHOLD).any():
            side = "BUY"
        elif crossed_down and (recent_rsi > config.RSI_SELL_THRESHOLD).any():
            side = "SELL"
        if side is None:
            return
        if config.ENABLE_ADX_REGIME_FILTER:
            adx_val = curr.get("adx")
            if pd.notna(adx_val) and adx_val > config.ADX_TREND_THRESHOLD:
                trend_up = curr["plus_di"] > curr["minus_di"]
                if (side == "BUY" and not trend_up) or (side == "SELL" and trend_up):
                    return
        atr_val = curr.get("atr")
        if pd.isna(atr_val) or atr_val <= 0:
            return
        entry_price = curr["price"]
        sl_dist, tp1_dist = config.MULTI_TP_SL_MULTIPLIER * atr_val, config.MULTI_TP_TP1_MULTIPLIER * atr_val
        tp2_dist, tp3_dist = config.MULTI_TP_TP2_MULTIPLIER * atr_val, config.MULTI_TP_TP3_MULTIPLIER * atr_val
        if side == "BUY":
            stop = entry_price - sl_dist
            tp1, tp2, tp3 = entry_price + tp1_dist, entry_price + tp2_dist, entry_price + tp3_dist
        else:
            stop = entry_price + sl_dist
            tp1, tp2, tp3 = entry_price - tp1_dist, entry_price - tp2_dist, entry_price - tp3_dist
        open_positions[key] = {
            "side": side, "entry_price": entry_price, "entry_idx": idx, "stop": stop,
            "tp1": tp1, "tp2": tp2, "tp3": tp3, "tp1_hit": False, "tp2_hit": False,
            "weight_remaining": 1.0, "pnl_pct_acc": 0.0, "entered_at": int(curr["ts_ms"]),
            "tp1_weight": config.MULTI_TP_TP1_WEIGHT, "tp2_weight": config.MULTI_TP_TP2_WEIGHT,
        }
        n_active_pre_tp1 += 1

    def try_enter_squeeze(pair, ts):
        nonlocal n_active_pre_tp1
        key = (pair, "squeeze_15m")
        if key in open_positions:
            return
        e = squeeze_enriched[pair]
        idx = squeeze_idx[pair].get(ts)
        min_points = config.SQUEEZE_LOOKBACK + config.SQUEEZE_BB_PERIOD
        if idx is None or idx < max(WARMUP_CANDLES, min_points) or idx >= len(e) - 1:
            return
        prev, curr = e.iloc[idx - 1], e.iloc[idx]
        if any(pd.isna(v) for v in (prev["bb_upper"], prev["bb_lower"], prev["bb_mid"],
                                      curr["bb_upper"], curr["bb_lower"], curr.get("atr"))):
            return
        band_width = (e["bb_upper"] - e["bb_lower"]) / e["bb_mid"]
        recent_widths = band_width.iloc[idx - config.SQUEEZE_LOOKBACK:idx]
        if recent_widths.isna().any() or len(recent_widths) < config.SQUEEZE_LOOKBACK:
            return
        threshold = recent_widths.quantile(config.SQUEEZE_PERCENTILE)
        if band_width.iloc[idx - 1] > threshold:
            return
        was_inside = prev["price"] <= prev["bb_upper"] and prev["price"] >= prev["bb_lower"]
        if not was_inside:
            return
        breakout_up = curr["price"] > curr["bb_upper"]
        breakout_down = curr["price"] < curr["bb_lower"]
        if not (breakout_up or breakout_down):
            return
        volume_sma = e["volume"].iloc[idx - config.SQUEEZE_VOLUME_SMA_PERIOD + 1:idx + 1].mean()
        if pd.isna(volume_sma) or volume_sma <= 0 or curr["volume"] <= volume_sma:
            return
        side = "BUY" if breakout_up else "SELL"
        atr_val = curr["atr"]
        entry_price = curr["price"]
        sl_dist = config.SQUEEZE_SL_MULTIPLIER * atr_val
        tp1_dist, tp2_dist, tp3_dist = (config.SQUEEZE_TP1_MULTIPLIER * atr_val,
                                          config.SQUEEZE_TP2_MULTIPLIER * atr_val, config.SQUEEZE_TP3_MULTIPLIER * atr_val)
        if side == "BUY":
            stop = entry_price - sl_dist
            tp1, tp2, tp3 = entry_price + tp1_dist, entry_price + tp2_dist, entry_price + tp3_dist
        else:
            stop = entry_price + sl_dist
            tp1, tp2, tp3 = entry_price - tp1_dist, entry_price - tp2_dist, entry_price - tp3_dist
        open_positions[key] = {
            "side": side, "entry_price": entry_price, "entry_idx": idx, "stop": stop,
            "tp1": tp1, "tp2": tp2, "tp3": tp3, "tp1_hit": False, "tp2_hit": False,
            "weight_remaining": 1.0, "pnl_pct_acc": 0.0, "entered_at": int(curr["ts_ms"]),
            "tp1_weight": config.SQUEEZE_TP1_WEIGHT, "tp2_weight": config.SQUEEZE_TP2_WEIGHT,
        }
        n_active_pre_tp1 += 1

    for ts in all_ts:
        for pair in list(hc_enriched.keys()):
            process_exits(pair, "high_confidence", hc_enriched, hc_idx, ts)
        for pair in list(squeeze_enriched.keys()):
            process_exits(pair, "squeeze_15m", squeeze_enriched, squeeze_idx, ts)

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


def main():
    logger.info("=== Backtest combiné Haute Confiance (1h) + Squeeze Volatilité (15m), %d paires, %d jours ===",
                len(BACKTEST_PAIRS), VALIDATION_DAYS)

    hc_dfs = fetch_all_klines_cached(pairs=BACKTEST_PAIRS, days=VALIDATION_DAYS)
    squeeze_dfs = fetch_15m_klines(pairs=BACKTEST_PAIRS, days=VALIDATION_DAYS)

    trades = simulate_combined_portfolio(hc_dfs, squeeze_dfs, max_active_trades=config.MAX_ACTIVE_TRADES)
    trades = filter_correlated_trades(trades, total_pairs=len(BACKTEST_PAIRS))

    hc_trades = [t for t in trades if t["engine"] == "high_confidence"]
    sq_trades = [t for t in trades if t["engine"] == "squeeze_15m"]

    for label, subset in [("🎯 Haute Confiance seul", hc_trades), ("⚡ Squeeze 15M seul", sq_trades), ("COMBINÉ", trades)]:
        wr = win_rate_of(subset)
        gl = gain_loss_ratio_of(subset)
        dd = max_drawdown_of(subset)
        logger.info(
            "%s -> %d trades (%.2f/jour), win rate TP1 = %.1f%%, ratio gain/perte = %s, drawdown max = %.1f%%",
            label, len(subset), len(subset) / VALIDATION_DAYS, wr * 100,
            f"{gl:.2f}" if gl else "n/a", dd,
        )

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
