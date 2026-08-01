"""
L'asymétrie ACHAT/VENTE est-elle structurelle, ou un artefact de régime ?

La décomposition sur 12 mois (backtest_decompose.py) a montré que tout
l'edge vient des signaux VENTE : BUY -0,0005% puis -0,1016% par trade sur
les deux semestres, SELL +0,2846% puis +0,2044%. C'est la seule poche
perdante identifiée qui soit à la fois consistante ET connue au moment
d'entrer en position (la durée de détention et l'atteinte de TP1 ne se
connaissent qu'après coup, donc inexploitables comme filtre).

Danger : 12 mois peuvent ne représenter qu'un seul régime de marché. Si la
période testée était globalement baissière, "les ventes gagnent" ne dit
rien de plus que "le marché a baissé" — et couper les achats se retournerait
violemment au prochain marché haussier.

Ce module tranche : 24 mois découpés en 4 périodes de 6 mois, avec pour
chacune la tendance de fond du marché (performance de BTC sur la période)
en regard. Une asymétrie structurelle doit tenir MÊME sur les périodes où
BTC monte.

Usage : python backtest_direction_regime.py
"""
import json
import logging
import os

import pandas as pd

import config
import binance_client
from backtest import simulate_portfolio_capped, filter_correlated_trades

logging.basicConfig(level=logging.WARNING, format="%(message)s")

DAYS = 730          # 24 mois
N_PERIODS = 4       # 4 tranches de ~6 mois
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "regime_cache")


def load_all():
    os.makedirs(CACHE_DIR, exist_ok=True)
    out = {}
    for pair in config.PAIRS:
        symbol = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbol}_1h_{DAYS}d.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                candles = json.load(f)
        else:
            candles = binance_client.get_historical_klines(symbol, interval="1h", days=DAYS)
            if candles:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(candles, f)
            print(f"  {pair}: {len(candles or [])} bougies", flush=True)
        if candles and len(candles) > 1000:
            out[pair] = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
    return out


def slice_period(pair_dfs, i, n):
    """Tranche chronologique i (0-indexée) sur n tranches égales."""
    out = {}
    for pair, df in pair_dfs.items():
        size = len(df) // n
        part = df.iloc[i * size:(i + 1) * size]
        if len(part) > 500:
            out[pair] = part.reset_index(drop=True)
    return out


def btc_trend(period_dfs):
    """Performance de BTC sur la tranche, en % — proxy du régime de marché."""
    df = period_dfs.get("BTC/USDT")
    if df is None or df.empty:
        return None
    first, last = df["price"].iloc[0], df["price"].iloc[-1]
    return (last - first) / first * 100


def stats_by_side(trades):
    out = {}
    for side in ("BUY", "SELL"):
        pnls = [t["pnl_pct"] * 100 for t in trades if t["side"] == side]
        out[side] = {
            "n": len(pnls),
            "exp": sum(pnls) / len(pnls) if pnls else 0.0,
            "wr": 100 * sum(1 for p in pnls if p > 0) / len(pnls) if pnls else 0.0,
        }
    allp = [t["pnl_pct"] * 100 for t in trades]
    out["TOUS"] = {
        "n": len(allp),
        "exp": sum(allp) / len(allp) if allp else 0.0,
        "wr": 100 * sum(1 for p in allp if p > 0) / len(allp) if allp else 0.0,
    }
    return out


print(f"Chargement de {DAYS} jours (24 mois)...", flush=True)
full = load_all()
period_days = DAYS // N_PERIODS
print(f"{len(full)} paires, {N_PERIODS} périodes de ~{period_days} jours.\n", flush=True)

results = []
for i in range(N_PERIODS):
    part = slice_period(full, i, N_PERIODS)
    trend = btc_trend(part)
    trades = filter_correlated_trades(
        simulate_portfolio_capped(
            part, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
            config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD,
            max_active_trades=config.MAX_ACTIVE_TRADES,
            rsi_cross_window=config.RSI_CROSS_WINDOW,
            use_adx_regime_filter=config.ENABLE_ADX_REGIME_FILTER,
        ),
        total_pairs=len(part),
    )
    s = stats_by_side(trades)
    results.append((i + 1, trend, s))
    regime = "HAUSSIER" if (trend or 0) > 5 else ("BAISSIER" if (trend or 0) < -5 else "PLAT")
    print(f"Période {i+1}/{N_PERIODS} | BTC {trend:+.1f}% ({regime})", flush=True)
    for side in ("BUY", "SELL", "TOUS"):
        d = s[side]
        print(f"    {side:5s} n={d['n']:4d}  espérance={d['exp']:+.4f}%  réussite={d['wr']:.1f}%", flush=True)

print("\n=== VERDICT ===")
buy_neg = sum(1 for _, _, s in results if s["BUY"]["exp"] < 0)
sell_pos = sum(1 for _, _, s in results if s["SELL"]["exp"] > 0)
print(f"BUY négatif sur {buy_neg}/{N_PERIODS} périodes.")
print(f"SELL positif sur {sell_pos}/{N_PERIODS} périodes.")

bull = [(i, t, s) for i, t, s in results if (t or 0) > 5]
if bull:
    print(f"\nComportement sur les {len(bull)} période(s) HAUSSIÈRE(S) — le test qui compte :")
    for i, t, s in bull:
        print(f"  Période {i} (BTC {t:+.1f}%) : BUY {s['BUY']['exp']:+.4f}%  SELL {s['SELL']['exp']:+.4f}%")
    buy_ok_bull = all(s["BUY"]["exp"] >= 0 for _, _, s in bull)
    sell_ok_bull = all(s["SELL"]["exp"] > 0 for _, _, s in bull)
    if sell_ok_bull and not buy_ok_bull:
        print("\n  -> L'asymétrie tient MÊME en marché haussier : elle est structurelle,")
        print("     pas un simple reflet de la direction du marché.")
    elif not sell_ok_bull:
        print("\n  -> Les VENTES perdent en marché haussier : l'avantage constaté sur 12 mois")
        print("     est un ARTEFACT DE RÉGIME. Couper les achats serait dangereux.")
else:
    print("\nAucune période franchement haussière sur 24 mois : impossible de distinguer")
    print("une asymétrie structurelle d'un artefact de régime. Ne pas couper les achats")
    print("sur cette seule base.")
