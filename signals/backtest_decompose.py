"""
Décomposition de la performance : OÙ l'argent se gagne et se perd.

Motif (01/08/2026) : la longue série d'explorations d'indicateurs d'entrée
(tâches #111-#137 : ML supervisé, Hurst, GARCH, cointégration, order book,
funding rate, chandeliers...) n'a produit presque aucun gain, alors que la
simple correction de la géométrie TP/SL a fait passer l'espérance de
-0,029% à +0,031% par trade sur le semestre récent. Conclusion : chercher
un nouveau signal d'entrée est le mauvais angle, il faut comprendre la
structure des résultats existants avant d'optimiser quoi que ce soit.

Ce module ne teste aucune idée : il découpe les trades du backtest selon
plusieurs axes et cherche des poches systématiquement perdantes ou
gagnantes. Écarter une poche perdante améliore l'espérance sans toucher à
la logique d'entrée -- et sans le risque de surapprentissage d'un nouvel
indicateur.

Axes analysés : paire, sens (BUY/SELL), durée de détention, heure d'entrée,
et atteinte de TP1. Chaque coupe est mesurée sur les DEUX semestres
séparément : une poche qui n'est perdante que sur un semestre est du bruit,
pas une structure.

Usage : python backtest_decompose.py
"""
import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone

import pandas as pd

import config
import binance_client
from backtest import simulate_portfolio_capped, filter_correlated_trades

logging.basicConfig(level=logging.WARNING, format="%(message)s")

DAYS = 365
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "sweep_cache")
MIN_SAMPLE = 15  # en dessous, une moyenne par catégorie n'a aucun sens


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
    out = {}
    for pair, df in pair_dfs.items():
        mid = len(df) // 2
        part = df.iloc[:mid] if which == 1 else df.iloc[mid:]
        if len(part) > 500:
            out[pair] = part.reset_index(drop=True)
    return out


def run_trades(pair_dfs):
    trades = simulate_portfolio_capped(
        pair_dfs, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
        config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD,
        max_active_trades=config.MAX_ACTIVE_TRADES,
        rsi_cross_window=config.RSI_CROSS_WINDOW,
        use_adx_regime_filter=config.ENABLE_ADX_REGIME_FILTER,
    )
    return filter_correlated_trades(trades, total_pairs=len(pair_dfs))


def enrich(trades):
    for t in trades:
        held_h = (t["exited_at"] - t["entered_at"]) / 3_600_000
        t["held_hours"] = held_h
        t["entry_hour_utc"] = datetime.fromtimestamp(t["entered_at"] / 1000, tz=timezone.utc).hour
        if held_h <= 6:
            t["duration_bucket"] = "0-6h"
        elif held_h <= 24:
            t["duration_bucket"] = "6-24h"
        elif held_h <= 72:
            t["duration_bucket"] = "1-3j"
        else:
            t["duration_bucket"] = ">3j"
        h = t["entry_hour_utc"]
        t["session"] = "Asie (0-7h)" if h < 8 else ("Europe (8-15h)" if h < 16 else "US (16-23h)")
    return trades


def summarize(trades, key_fn):
    buckets = defaultdict(list)
    for t in trades:
        buckets[key_fn(t)].append(t["pnl_pct"] * 100)
    return {
        k: {"n": len(v), "exp": sum(v) / len(v), "wr": 100 * sum(1 for x in v if x > 0) / len(v)}
        for k, v in buckets.items()
    }


def report_axis(name, s1, s2, sort_by_exp=True):
    print(f"\n--- {name} ---")
    keys = set(s1) | set(s2)
    rows = []
    for k in keys:
        a, b = s1.get(k), s2.get(k)
        if not a or not b or a["n"] < MIN_SAMPLE or b["n"] < MIN_SAMPLE:
            continue
        rows.append((k, a, b, min(a["exp"], b["exp"])))
    if not rows:
        print(f"  (aucune catégorie avec >= {MIN_SAMPLE} trades sur les DEUX semestres)")
        return []
    rows.sort(key=lambda r: r[3] if sort_by_exp else str(r[0]))
    for k, a, b, worst in rows:
        verdict = ""
        if a["exp"] < 0 and b["exp"] < 0:
            verdict = "  <<< PERDANT sur les 2 semestres"
        elif a["exp"] > 0 and b["exp"] > 0:
            verdict = "  (gagnant sur les 2)"
        print(f"  {str(k):16s} | S1 n={a['n']:4d} exp={a['exp']:+.4f}% | "
              f"S2 n={b['n']:4d} exp={b['exp']:+.4f}%{verdict}")
    return rows


print("Chargement...", flush=True)
full = load_all()
h1, h2 = slice_half(full, 1), slice_half(full, 2)
print(f"{len(full)} paires.\n", flush=True)

print("Simulation semestre 1...", flush=True)
t1 = enrich(run_trades(h1))
print("Simulation semestre 2...", flush=True)
t2 = enrich(run_trades(h2))
print(f"\n{len(t1)} trades S1, {len(t2)} trades S2 (géométrie actuelle).")

for label, fn, sort_exp in [
    ("SENS", lambda t: t["side"], False),
    ("DURÉE DE DÉTENTION", lambda t: t["duration_bucket"], False),
    ("SESSION D'ENTRÉE", lambda t: t["session"], False),
    ("TP1 ATTEINT", lambda t: "TP1 oui" if t["tp1_hit"] else "TP1 non", False),
    ("PAIRE", lambda t: t["pair"], True),
]:
    report_axis(label, summarize(t1, fn), summarize(t2, fn), sort_by_exp=sort_exp)

# Poches perdantes sur les DEUX semestres : candidates à l'exclusion.
print("\n=== POCHES PERDANTES SUR LES DEUX SEMESTRES (candidates à l'exclusion) ===")
found_any = False
for label, fn in [("sens", lambda t: t["side"]), ("durée", lambda t: t["duration_bucket"]),
                  ("session", lambda t: t["session"]), ("paire", lambda t: t["pair"])]:
    s1, s2 = summarize(t1, fn), summarize(t2, fn)
    for k in set(s1) & set(s2):
        a, b = s1[k], s2[k]
        if a["n"] >= MIN_SAMPLE and b["n"] >= MIN_SAMPLE and a["exp"] < 0 and b["exp"] < 0:
            found_any = True
            print(f"  [{label}] {k}: S1 {a['exp']:+.4f}% (n={a['n']}), S2 {b['exp']:+.4f}% (n={b['n']})")
if not found_any:
    print("  Aucune. Les pertes sont réparties, pas concentrées dans une poche identifiable.")

# Gain potentiel si on retirait les paires perdantes sur les deux semestres.
s1p, s2p = summarize(t1, lambda t: t["pair"]), summarize(t2, lambda t: t["pair"])
bad = {p for p in set(s1p) & set(s2p)
       if s1p[p]["n"] >= MIN_SAMPLE and s2p[p]["n"] >= MIN_SAMPLE
       and s1p[p]["exp"] < 0 and s2p[p]["exp"] < 0}
if bad:
    for lbl, tr in [("S1", t1), ("S2", t2)]:
        kept = [t for t in tr if t["pair"] not in bad]
        before = sum(t["pnl_pct"] for t in tr) / len(tr) * 100
        after = sum(t["pnl_pct"] for t in kept) / len(kept) * 100 if kept else 0
        print(f"\n{lbl} : espérance {before:+.4f}% -> {after:+.4f}% en retirant {len(bad)} paire(s) "
              f"({len(tr)} -> {len(kept)} trades)")
    print(f"Paires concernées : {', '.join(sorted(bad))}")
