"""
Filtre de régime de marché : ne pas trader quand le marché part en tendance
haussière forte.

Constat décisif (backtest_direction_regime.py, 24 mois / 4 périodes) :

  Période 1 : BTC +63.8%  ->  espérance -0.2764%/trade   PERDANT
  Période 2 : BTC  +9.6%  ->  espérance +0.1507%/trade
  Période 3 : BTC -27.3%  ->  espérance +0.1106%/trade
  Période 4 : BTC -25.0%  ->  espérance +0.0590%/trade

La stratégie gagne en marché plat ou baissier et perd en marché fortement
haussier. Ce n'est pas une coïncidence statistique : c'est une stratégie de
RETOUR À LA MOYENNE (RSI en zone extrême + croisement EMA). En tendance
forte, le retour à la moyenne se fait écraser — on vend dans la force qui
continue, et les achats se font sortir par des replis qui repartent.

Ce module teste si la tendance de fond de BTC, connue EN TEMPS RÉEL au
moment d'entrer, permet d'éviter ces périodes. La règle doit être causale
(calculable à l'instant t, sans regard vers le futur) et tenir sur les
QUATRE périodes, pas seulement sur celle qui a motivé l'idée.

Usage : python backtest_market_regime.py
"""
import json
import logging
import os
from collections import defaultdict

import pandas as pd

import config
import binance_client
from backtest import simulate_portfolio_capped, filter_correlated_trades

logging.basicConfig(level=logging.WARNING, format="%(message)s")

DAYS = 730
N_PERIODS = 4
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "regime_cache")
TREND_LOOKBACK_H = 24 * 14  # tendance BTC sur 14 jours glissants


def load_all():
    out = {}
    for pair in config.PAIRS:
        symbol = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbol}_1h_{DAYS}d.json")
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            candles = json.load(f)
        if candles and len(candles) > 1000:
            out[pair] = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
    return out


def slice_period(pair_dfs, i, n):
    out = {}
    for pair, df in pair_dfs.items():
        size = len(df) // n
        part = df.iloc[i * size:(i + 1) * size]
        if len(part) > 500:
            out[pair] = part.reset_index(drop=True)
    return out


def btc_trend_series(btc_df):
    """
    Tendance BTC glissante sur TREND_LOOKBACK_H, indexée par timestamp.
    Strictement causale : à l'instant t, n'utilise que des prix <= t.
    """
    prices = btc_df["price"]
    past = prices.shift(TREND_LOOKBACK_H)
    trend = (prices - past) / past * 100
    return dict(zip(btc_df["ts_ms"].values, trend.values))


def run_period(part):
    trades = simulate_portfolio_capped(
        part, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
        config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD,
        max_active_trades=config.MAX_ACTIVE_TRADES,
        rsi_cross_window=config.RSI_CROSS_WINDOW,
        use_adx_regime_filter=config.ENABLE_ADX_REGIME_FILTER,
    )
    return filter_correlated_trades(trades, total_pairs=len(part))


def exp_of(trades):
    return sum(t["pnl_pct"] for t in trades) / len(trades) * 100 if trades else 0.0


print("Chargement (24 mois)...", flush=True)
full = load_all()
print(f"{len(full)} paires.\n", flush=True)

# Collecte : chaque trade annoté de la tendance BTC connue à son entrée.
all_trades = []
for i in range(N_PERIODS):
    part = slice_period(full, i, N_PERIODS)
    btc = part.get("BTC/USDT")
    if btc is None:
        continue
    trend_at = btc_trend_series(btc)
    ts_sorted = sorted(trend_at)
    for t in run_period(part):
        # Tendance BTC à la bougie d'entrée (ou la plus proche antérieure).
        entered = t["entered_at"]
        val = trend_at.get(entered)
        if val is None or pd.isna(val):
            prior = [ts for ts in ts_sorted if ts <= entered]
            val = trend_at.get(prior[-1]) if prior else None
        if val is None or pd.isna(val):
            continue
        t["btc_trend"] = float(val)
        t["period"] = i + 1
        all_trades.append(t)
    print(f"Période {i+1} traitée ({len(all_trades)} trades cumulés).", flush=True)

print(f"\n{len(all_trades)} trades annotés de la tendance BTC à l'entrée.")

print("\n=== ESPÉRANCE PAR TRANCHE DE TENDANCE BTC (14 jours glissants) ===")
def bucket(v):
    if v < -15: return "1. BTC < -15%"
    if v < -5:  return "2. -15..-5%"
    if v < 5:   return "3. -5..+5% (plat)"
    if v < 15:  return "4. +5..+15%"
    if v < 30:  return "5. +15..+30%"
    return "6. BTC > +30%"

buckets = defaultdict(list)
for t in all_trades:
    buckets[bucket(t["btc_trend"])].append(t)
for k in sorted(buckets):
    tr = buckets[k]
    e = exp_of(tr)
    flag = "  <<< PERDANT" if e < 0 else ""
    print(f"  {k:20s} n={len(tr):4d}  espérance={e:+.4f}%{flag}")

print("\n=== EFFET D'UN SEUIL DE COUPURE (ne pas trader au-dessus) ===")
print(f"{'seuil':>12s} | {'trades gardés':>13s} | {'% gardés':>8s} | {'espérance':>10s} | par période")
base_exp = exp_of(all_trades)
print(f"{'aucun':>12s} | {len(all_trades):>13d} | {'100%':>8s} | {base_exp:+.4f}%   |", end=" ")
per = {i: exp_of([t for t in all_trades if t['period'] == i]) for i in range(1, N_PERIODS + 1)}
print("  ".join(f"P{i}:{per[i]:+.3f}" for i in sorted(per)))

best = None
for seuil in (30, 25, 20, 15, 12, 10, 8, 5):
    kept = [t for t in all_trades if t["btc_trend"] < seuil]
    if not kept:
        continue
    e = exp_of(kept)
    per_k = {}
    for i in range(1, N_PERIODS + 1):
        sub = [t for t in kept if t["period"] == i]
        per_k[i] = exp_of(sub) if sub else 0.0
    all_pos = all(v > 0 for v in per_k.values())
    mark = "  <-- positif sur les 4 périodes" if all_pos else ""
    print(f"{'< ' + str(seuil) + '%':>12s} | {len(kept):>13d} | {100*len(kept)/len(all_trades):>7.0f}% | "
          f"{e:+.4f}%   | " + "  ".join(f"P{i}:{per_k[i]:+.3f}" for i in sorted(per_k)) + mark)
    if all_pos and (best is None or e > best[1]):
        best = (seuil, e, len(kept), per_k)

print()
if best:
    seuil, e, n, per_k = best
    print(f"RETENU : ne pas trader quand BTC a pris plus de {seuil}% en 14 jours.")
    print(f"  espérance {base_exp:+.4f}% -> {e:+.4f}%  |  {n}/{len(all_trades)} trades conservés "
          f"({100*n/len(all_trades):.0f}%)")
    print(f"  positif sur les 4 périodes : " + ", ".join(f"P{i} {per_k[i]:+.3f}%" for i in sorted(per_k)))
else:
    print("Aucun seuil ne rend l'espérance positive sur les QUATRE périodes.")
    print("Le régime haussier n'est pas capturable par ce seul indicateur.")
