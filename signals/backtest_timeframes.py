"""
Recherche d'un edge qui SURVIT AUX FRAIS, par changement d'unité de temps.

Le constat qui motive ce module (02/08/2026, voir
DIAGNOSTIC_SIGNAUX_2026-08-01.md) : sur 24 mois, la stratégie en production
affiche une espérance de -0,0112 % par trade AVANT frais. Or un aller-retour
coûte 0,05 à 0,10 % sur un exchange courant. Les frais sont donc 5 à 10 fois
plus GROS que l'avantage recherché, et le cumulé passe de -19,7 % à -107,9 %
une fois payés — soit un compte vidé.

Le raisonnement qui en découle est arithmétique, pas une intuition :

  Les frais sont un pourcentage de la POSITION, pas du MOUVEMENT capturé.
  Un trade qui vise 0,3 % paie exactement les mêmes frais qu'un trade qui
  vise 3 %. Sur bougies horaires, l'ATR est petit : les objectifs, calés sur
  l'ATR, sont petits eux aussi, et 0,10 % de frais représente une part
  énorme du gain visé. Sur des bougies 4h ou journalières, l'ATR est
  plusieurs fois supérieur — les mêmes 0,10 % deviennent marginaux.

Ce module teste donc la MÊME stratégie (croisement EMA + confirmation RSI +
filtre ADX, géométrie Multi-TP inchangée) sur trois unités de temps, et
mesure l'espérance NETTE de frais. Une variante n'est retenue que si elle
reste positive après frais sur les QUATRE périodes de 6 mois — même critère
de walk-forward qui a fait rejeter le moteur Squeeze, l'assouplissement RSI
et le filtre de régime.

Attention à l'arbitrage : une unité de temps plus longue produit MOINS de
signaux. Mais multiplier les trades sur une espérance négative ne fait
qu'accélérer les pertes ; la quantité n'a de valeur qu'une fois l'espérance
solidement positive. C'est donc l'espérance nette qui décide, et la quantité
qui départage ensuite.

Usage : python backtest_timeframes.py
"""

import json
import logging
import os

import pandas as pd

import config
import binance_client
from backtest import simulate_portfolio_capped, filter_correlated_trades, max_drawdown_of

logging.basicConfig(level=logging.WARNING, format="%(message)s")

DAYS = 730
N_PERIODS = 4
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "tf_cache")

# Aller-retour taker sur un exchange courant. 0,10 % est le chiffre réaliste ;
# 0,05 % suppose des frais maker des deux côtés, ce qui n'est pas atteignable
# sur des ordres au marché déclenchés par un signal.
FEE_ROUND_TRIP_PCT = 0.10

# (libellé, intervalle Binance, bougies par jour)
TIMEFRAMES = [
    ("1h  (production actuelle)", "1h", 24),
    ("4h", "4h", 6),
    ("1 jour", "1d", 1),
]


def load(interval: str):
    os.makedirs(CACHE_DIR, exist_ok=True)
    out = {}
    for pair in config.PAIRS:
        symbol = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbol}_{interval}_{DAYS}d.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                candles = json.load(f)
        else:
            candles = binance_client.get_historical_klines(symbol, interval=interval, days=DAYS)
            if candles:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(candles, f)
        # Il faut assez de bougies pour la chauffe des indicateurs (WARMUP=100)
        # plus une fenêtre de test exploitable.
        if candles and len(candles) > 300:
            out[pair] = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
    return out


def slice_period(pair_dfs, i, n):
    out = {}
    for pair, df in pair_dfs.items():
        size = len(df) // n
        part = df.iloc[i * size:(i + 1) * size]
        if len(part) > 150:
            out[pair] = part.reset_index(drop=True)
    return out


def evaluate(pair_dfs, candles_per_day, days):
    """Trades + métriques, avec le délai d'expiration converti dans l'unité de temps."""
    timeout = max(3, config.BACKTEST_TRADE_TIMEOUT_DAYS * candles_per_day)
    trades = simulate_portfolio_capped(
        pair_dfs, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
        config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD,
        max_active_trades=config.MAX_ACTIVE_TRADES,
        rsi_cross_window=config.RSI_CROSS_WINDOW,
        use_adx_regime_filter=config.ENABLE_ADX_REGIME_FILTER,
        timeout_periods=timeout,
    )
    trades = filter_correlated_trades(trades, total_pairs=len(pair_dfs))
    if not trades:
        return None
    pnls = [t["pnl_pct"] * 100 for t in trades]
    gross = sum(pnls) / len(pnls)
    return {
        "n": len(trades),
        "per_day": len(trades) / days,
        "gross": gross,
        "net": gross - FEE_ROUND_TRIP_PCT,
        "wr": 100 * sum(1 for p in pnls if p > 0) / len(pnls),
        "dd": max_drawdown_of(trades),
    }


print(f"Frais retenus : {FEE_ROUND_TRIP_PCT}% par aller-retour\n", flush=True)
results = {}

for label, interval, cpd in TIMEFRAMES:
    print(f"=== {label} ===", flush=True)
    data = load(interval)
    if not data:
        print("  données indisponibles\n", flush=True)
        continue
    print(f"  {len(data)} paires chargées", flush=True)

    full = evaluate(data, cpd, DAYS)
    if not full:
        print("  aucun trade\n", flush=True)
        continue
    print(f"  24 mois : {full['n']:5d} trades ({full['per_day']:5.2f}/j) | "
          f"brut {full['gross']:+.4f}% | NET {full['net']:+.4f}% | "
          f"WR {full['wr']:.1f}% | DD {full['dd']:.0f}%", flush=True)

    per_period = []
    for i in range(N_PERIODS):
        m = evaluate(slice_period(data, i, N_PERIODS), cpd, DAYS // N_PERIODS)
        per_period.append(m)
        if m:
            print(f"    P{i+1} : {m['per_day']:5.2f}/j | brut {m['gross']:+.4f}% | NET {m['net']:+.4f}%", flush=True)
        else:
            print(f"    P{i+1} : aucun trade", flush=True)

    ok = [p for p in per_period if p]
    stable = len(ok) == N_PERIODS and all(p["net"] > 0 for p in ok)
    results[label] = {"full": full, "periods": per_period, "stable": stable}
    print(f"  -> net positif sur les 4 périodes : {'OUI' if stable else 'non'}\n", flush=True)

print("=== VERDICT ===")
viable = [(l, r) for l, r in results.items() if r["stable"]]
if not viable:
    print("Aucune unité de temps ne donne une espérance NETTE positive sur les 4 périodes.")
    best = max(results.items(), key=lambda kv: kv[1]["full"]["net"]) if results else None
    if best:
        print(f"La moins mauvaise : {best[0]} à {best[1]['full']['net']:+.4f}% net par trade.")
    print("\nChanger d'unité de temps ne suffit donc pas à absorber les frais.")
else:
    viable.sort(key=lambda kv: -kv[1]["full"]["per_day"])
    print("Unité(s) de temps à espérance NETTE positive sur les 4 périodes :")
    for label, r in viable:
        f = r["full"]
        print(f"  {label} : {f['per_day']:.2f} signaux/jour | net {f['net']:+.4f}%/trade | "
              f"soit {f['net'] * f['per_day']:+.4f}%/jour | DD {f['dd']:.0f}%")
