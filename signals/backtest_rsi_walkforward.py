"""
Validation walk-forward des variantes RSI prometteuses (audit du 01/08/2026).

Le balayage in-sample (_sweep_rsi.py) a désigné B1 (fenêtre RSI 3, seuils
45/55) et B2 (fenêtre 1, seuils 45/55) comme nettement supérieures à la
production actuelle en quantité, à espérance égale ou meilleure. Mais un
classement établi sur la même période que celle qui sert à le juger ne
prouve rien (c'est précisément le motif pour lequel le moteur Squeeze est
resté désactivé, voir SQUEEZE_EXPLORATION_2026-07-31.md).

Ce script découpe les 12 mois en deux moitiés indépendantes et vérifie que
l'avantage tient sur CHACUNE. Une variante qui ne gagne que sur une moitié
est un artefact de période, pas un edge.
"""
import json
import os
import logging

import pandas as pd

import config
import binance_client
from backtest import (
    simulate_portfolio_capped, filter_correlated_trades,
    win_rate_of, gain_loss_ratio_of, max_drawdown_of,
)

logging.basicConfig(level=logging.WARNING, format="%(message)s")

DAYS = 365
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "sweep_cache")


def load_all():
    out = {}
    for pair in config.PAIRS:
        symbol = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbol}_1h_{DAYS}d.json")
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            candles = json.load(f)
        if candles and len(candles) > 500:
            out[pair] = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
    return out


def slice_half(pair_dfs, which):
    """Première ou seconde moitié chronologique, par paire."""
    out = {}
    for pair, df in pair_dfs.items():
        mid = len(df) // 2
        part = df.iloc[:mid] if which == 1 else df.iloc[mid:]
        if len(part) > 500:
            out[pair] = part.reset_index(drop=True)
    return out


def expectancy_of(trades):
    return sum(t["pnl_pct"] for t in trades) / len(trades) if trades else 0.0


def evaluate(pair_dfs, win, rbuy, rsell, days):
    trades = simulate_portfolio_capped(
        pair_dfs, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD, rbuy, rsell,
        max_active_trades=config.MAX_ACTIVE_TRADES,
        rsi_cross_window=win, use_adx_regime_filter=config.ENABLE_ADX_REGIME_FILTER,
    )
    trades = filter_correlated_trades(trades, total_pairs=len(pair_dfs))
    return {
        "n": len(trades),
        "per_day": len(trades) / days,
        "wr": win_rate_of(trades) * 100,
        "exp": expectancy_of(trades) * 100,
        "dd": max_drawdown_of(trades),
    }


print("Chargement...", flush=True)
full = load_all()
halves = {1: slice_half(full, 1), 2: slice_half(full, 2)}
print(f"{len(full)} paires, moitiés de ~{DAYS//2} jours.\n", flush=True)

VARIANTS = [
    ("A0 production (win=1, 40/60)", 1, 40, 60),
    ("B2 (win=1, 45/55)", 1, 45, 55),
    ("B1 (win=3, 45/55)", 3, 45, 55),
]

results = {}
for label, win, rbuy, rsell in VARIANTS:
    results[label] = {}
    for h in (1, 2):
        m = evaluate(halves[h], win, rbuy, rsell, DAYS // 2)
        results[label][h] = m
        print(f"{label:32s} | moitié {h} -> {m['per_day']:5.2f}/j, WR={m['wr']:5.1f}%, "
              f"esperance={m['exp']:+.4f}%, DD={m['dd']:5.1f}%", flush=True)

print("\n=== Stabilité (l'avantage tient-il sur les DEUX moitiés ?) ===")
base = results["A0 production (win=1, 40/60)"]
for label, _, _, _ in VARIANTS[1:]:
    r = results[label]
    better_1 = r[1]["exp"] >= base[1]["exp"]
    better_2 = r[2]["exp"] >= base[2]["exp"]
    more_1 = r[1]["per_day"] > base[1]["per_day"]
    more_2 = r[2]["per_day"] > base[2]["per_day"]
    verdict = "STABLE" if (better_1 and better_2 and more_1 and more_2) else "INSTABLE"
    print(f"{label:32s} : espérance >= prod sur moitié1={better_1}, moitié2={better_2} ; "
          f"plus de signaux moitié1={more_1}, moitié2={more_2} -> {verdict}")
