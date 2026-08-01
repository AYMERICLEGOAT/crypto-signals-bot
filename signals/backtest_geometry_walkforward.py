"""
Recherche d'une géométrie TP/SL à espérance solidement positive
(mission "plus de quantité ET plus de qualité", 01/08/2026).

Point de départ du diagnostic (voir DIAGNOSTIC_SIGNAUX_2026-08-01.md) : la
stratégie affiche 60% de réussite mais un ratio gain/perte de seulement
0,67 — les gagnants rapportent moins que ce que coûtent les perdants. Sur
100 trades : 60 x 0,67 = 40,2 contre 40 x 1,0 = 40,0. À l'équilibre au
cheveu près, donc négatif dès que le taux de réussite perd 1,5 point (ce
qui s'est produit sur le semestre récent : espérance -0,029%/trade).

Cause structurelle : SL = 1,5xATR alors que TP1 = 1,0xATR encaisse 50% du
volume. On risque 1,5 pour sécuriser 1,0 sur la moitié de la position. Ce
module teste des géométries qui corrigent ce déséquilibre.

Discipline : chaque variante est évaluée sur DEUX moitiés chronologiques
indépendantes. Une variante n'est retenue que si son espérance est
positive sur les DEUX — critère qui a fait rejeter le moteur Squeeze
(SQUEEZE_EXPLORATION_2026-07-31.md) et l'assouplissement des seuils RSI.

Phase 1 : géométrie seule, réglages RSI de production inchangés.
Phase 2 : les meilleures géométries recroisées avec les réglages RSI qui
          donnent beaucoup plus de signaux — l'objectif final étant
          quantité ET qualité, pas l'une au détriment de l'autre.

Usage : python backtest_geometry_walkforward.py
"""
import json
import logging
import os

import pandas as pd

import config
import binance_client
from backtest import (
    simulate_portfolio_capped, filter_correlated_trades,
    win_rate_of, gain_loss_ratio_of, max_drawdown_of,
)

logging.basicConfig(level=logging.WARNING, format="%(message)s")

DAYS = 365
HALF_DAYS = DAYS // 2
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
    out = {}
    for pair, df in pair_dfs.items():
        mid = len(df) // 2
        part = df.iloc[:mid] if which == 1 else df.iloc[mid:]
        if len(part) > 500:
            out[pair] = part.reset_index(drop=True)
    return out


def expectancy_of(trades):
    return sum(t["pnl_pct"] for t in trades) / len(trades) if trades else 0.0


def apply_geometry(g):
    """La simulation lit config.MULTI_TP_* à chaque appel : on pilote donc la
    géométrie en réécrivant ces attributs avant d'évaluer."""
    config.MULTI_TP_SL_MULTIPLIER = g["sl"]
    config.MULTI_TP_TP1_MULTIPLIER = g["tp1"]
    config.MULTI_TP_TP2_MULTIPLIER = g["tp2"]
    config.MULTI_TP_TP3_MULTIPLIER = g["tp3"]
    config.MULTI_TP_TP1_WEIGHT = g["w1"]
    config.MULTI_TP_TP2_WEIGHT = g["w2"]
    config.MULTI_TP_TP3_WEIGHT = round(1.0 - g["w1"] - g["w2"], 4)


def evaluate(pair_dfs, rsi_win, rbuy, rsell, days):
    trades = simulate_portfolio_capped(
        pair_dfs, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD, rbuy, rsell,
        max_active_trades=config.MAX_ACTIVE_TRADES,
        rsi_cross_window=rsi_win, use_adx_regime_filter=config.ENABLE_ADX_REGIME_FILTER,
    )
    trades = filter_correlated_trades(trades, total_pairs=len(pair_dfs))
    gl = gain_loss_ratio_of(trades)
    return {
        "n": len(trades), "per_day": len(trades) / days,
        "wr": win_rate_of(trades) * 100, "gl": gl if gl else 0.0,
        "exp": expectancy_of(trades) * 100, "dd": max_drawdown_of(trades),
    }


# sl / tp1 / tp2 / tp3 en multiples d'ATR ; w1,w2 = fractions sorties à TP1/TP2
GEOMETRIES = [
    ("G0 production (SL1.5 TP1.0/3.3/5.0 w.5/.3)", {"sl": 1.5, "tp1": 1.0, "tp2": 3.3, "tp3": 5.0, "w1": 0.5, "w2": 0.3}),
    ("G1 stop resserré (SL1.2)",                   {"sl": 1.2, "tp1": 1.0, "tp2": 3.3, "tp3": 5.0, "w1": 0.5, "w2": 0.3}),
    ("G2 TP1 plus loin (1.5)",                     {"sl": 1.5, "tp1": 1.5, "tp2": 3.3, "tp3": 5.0, "w1": 0.5, "w2": 0.3}),
    ("G3 moins de poids sur TP1 (.3)",             {"sl": 1.5, "tp1": 1.0, "tp2": 3.3, "tp3": 5.0, "w1": 0.3, "w2": 0.3}),
    ("G4 SL1.2 + TP1 1.5",                         {"sl": 1.2, "tp1": 1.5, "tp2": 3.3, "tp3": 5.0, "w1": 0.5, "w2": 0.3}),
    ("G5 runner (TP3 6.0, w.3/.3)",                {"sl": 1.5, "tp1": 1.2, "tp2": 3.5, "tp3": 6.0, "w1": 0.3, "w2": 0.3}),
    ("G6 SL1.2 + runner",                          {"sl": 1.2, "tp1": 1.3, "tp2": 3.5, "tp3": 6.0, "w1": 0.3, "w2": 0.3}),
    ("G7 SL1.0 serré",                             {"sl": 1.0, "tp1": 1.2, "tp2": 3.0, "tp3": 5.0, "w1": 0.4, "w2": 0.3}),
    ("G8 TP3 très loin (7.0)",                     {"sl": 1.5, "tp1": 1.0, "tp2": 3.3, "tp3": 7.0, "w1": 0.4, "w2": 0.3}),
    ("G9 équilibré (SL1.3 TP1 1.4)",               {"sl": 1.3, "tp1": 1.4, "tp2": 3.5, "tp3": 5.5, "w1": 0.35, "w2": 0.3}),
]

print("Chargement des données 1h / 365 jours...", flush=True)
full = load_all()
halves = {1: slice_half(full, 1), 2: slice_half(full, 2)}
print(f"{len(full)} paires, deux moitiés de ~{HALF_DAYS} jours.\n", flush=True)

RSI_PROD = (1, 40, 60)

print("=== PHASE 1 : géométrie seule (réglages RSI de production) ===", flush=True)
phase1 = []
for label, g in GEOMETRIES:
    apply_geometry(g)
    m1 = evaluate(halves[1], *RSI_PROD, HALF_DAYS)
    m2 = evaluate(halves[2], *RSI_PROD, HALF_DAYS)
    both_positive = m1["exp"] > 0 and m2["exp"] > 0
    phase1.append((label, g, m1, m2, both_positive))
    flag = "OK-2/2" if both_positive else "      "
    print(f"{flag} {label:44s} | M1 exp={m1['exp']:+.4f}% G/P={m1['gl']:.2f} | "
          f"M2 exp={m2['exp']:+.4f}% G/P={m2['gl']:.2f} | {m2['per_day']:.2f}/j DD={m2['dd']:.0f}%", flush=True)

survivors = [p for p in phase1 if p[4]]
print(f"\n{len(survivors)} géométrie(s) à espérance positive sur les DEUX moitiés.", flush=True)

if not survivors:
    print("\nAucune géométrie ne franchit le critère. Rien à appliquer en production.")
    raise SystemExit(0)

# Les meilleures = celles dont la moitié RÉCENTE (la plus prédictive du futur
# proche) est la plus solide.
survivors.sort(key=lambda p: -p[3]["exp"])
best = survivors[:3]

print("\n=== PHASE 2 : meilleures géométries x réglages RSI à fort volume ===", flush=True)
RSI_VARIANTS = [
    ("RSI prod (win1 40/60)", 1, 40, 60),
    ("RSI large (win1 45/55)", 1, 45, 55),
    ("RSI très large (win3 45/55)", 3, 45, 55),
]
final = []
for label, g, _, _, _ in best:
    apply_geometry(g)
    for rlabel, win, rb, rs in RSI_VARIANTS:
        m1 = evaluate(halves[1], win, rb, rs, HALF_DAYS)
        m2 = evaluate(halves[2], win, rb, rs, HALF_DAYS)
        ok = m1["exp"] > 0 and m2["exp"] > 0
        final.append((label, rlabel, g, (win, rb, rs), m1, m2, ok))
        flag = "OK-2/2" if ok else "      "
        print(f"{flag} {label[:28]:28s} + {rlabel:26s} | M1 {m1['exp']:+.4f}% | "
              f"M2 {m2['exp']:+.4f}% | {m2['per_day']:5.2f}/j | DD {m2['dd']:.0f}%", flush=True)

print("\n=== RETENU : espérance positive sur les 2 moitiés, trié par quantité ===")
winners = [f for f in final if f[6]]
if not winners:
    print("Aucune combinaison ne tient sur les deux moitiés.")
else:
    winners.sort(key=lambda f: -f[5]["per_day"])
    for label, rlabel, g, rsi, m1, m2, _ in winners:
        print(f"{m2['per_day']:6.2f}/j | M1 {m1['exp']:+.4f}% | M2 {m2['exp']:+.4f}% | "
              f"WR {m2['wr']:.1f}% | G/P {m2['gl']:.2f} | DD {m2['dd']:.0f}% | {label} + {rlabel}")
        print(f"         geometry={g} rsi(win,buy,sell)={rsi}")
