"""
Test de FALSIFICATION : le signe du RSI est-il inversé ?

Origine. Une recherche documentaire menée le 02/08/2026 a fait remonter
Fieberg, Liedtke, Poddig, Walker & Zaremba, *Journal of Financial and
Quantitative Analysis* (2024) : 3 245 cryptomonnaies, avril 2015 - mai 2022,
quintiles pondérés par capitalisation et rebalancés chaque semaine.

  RSI(14) quintile BAS  : +0,00 % / semaine
  RSI(14) quintile HAUT : +3,52 % / semaine

Or la stratégie en production achète sur RSI < 40, c'est-à-dire précisément
le quintile BAS. Si ce résultat se réplique sur notre univers et notre
période, la stratégie ne serait pas « sans edge » : elle serait à l'ENVERS.

Cela expliquerait aussi l'observation la plus intrigante du projet — la
dégradation du 1h vers le 4h. Un signal pris à contresens perd d'autant plus
que le bruit diminue et que le vrai phénomène s'exprime.

Ce module compare donc, à protocole strictement identique :
  - QUINTILE BAS  : acheter les RSI les plus faibles (= direction actuelle)
  - QUINTILE HAUT : acheter les RSI les plus élevés (= thèse de l'étude)
  - Témoin aléatoire, à turnover et frais identiques

Le témoin aléatoire est indispensable : c'est lui qui a réfuté le momentum
transversal (p = 0,885), alors que celui-ci paraissait excellent sur
17 combinaisons de paramètres sur 18. Aucune conclusion sans lui.

Usage : python backtest_rsi_inverse.py
"""

import random

import pandas as pd

from backtest_cross_momentum import load_daily, FEE_ONE_WAY_PCT

N_PERIODS = 4
N_PERMUTATIONS = 300


def rsi_frame(prices, period=14):
    """RSI de Wilder, calculé colonne par colonne sur les clôtures journalières."""
    delta = prices.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


def run(prices, rsi, n_hold, rebal_days, side):
    """
    `side` : "haut" pour acheter les RSI les plus élevés (thèse de l'étude),
    "bas" pour les plus faibles (direction actuelle de la production).
    Long-only, équipondéré, frais comptés sur les seules lignes qui changent.
    """
    dates = prices.index
    start = 20
    if len(dates) <= start + rebal_days:
        return None

    equity = [1.0]
    held = set()
    n_trades = 0
    rets = []

    for i in range(start, len(dates) - rebal_days, rebal_days):
        rank = rsi.iloc[i].dropna()
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = rank.index[entry[rank.index].notna() & exit_[rank.index].notna()]
        rank = rank[valid]
        if len(rank) < n_hold:
            continue

        picks = set(rank.nlargest(n_hold).index if side == "haut" else rank.nsmallest(n_hold).index)
        changed = len(picks - held) + len(held - picks)
        n_trades += changed
        fee = (changed / max(1, n_hold)) * (FEE_ONE_WAY_PCT / 100.0)

        r = ((exit_[list(picks)] - entry[list(picks)]) / entry[list(picks)]).mean() - fee
        rets.append(r)
        equity.append(equity[-1] * (1 + r))
        held = picks

    if not rets:
        return None
    eq = pd.Series(equity)
    return {
        "total": (eq.iloc[-1] - 1) * 100,
        "moyenne_par_rebal": sum(rets) / len(rets) * 100,
        "positifs": 100 * sum(1 for r in rets if r > 0) / len(rets),
        "drawdown": ((eq - eq.cummax()) / eq.cummax()).min() * 100,
        "trades_par_jour": n_trades / max(1, len(dates) - start),
        "n_rebal": len(rets),
    }


def run_random(prices, n_hold, rebal_days, seed):
    """Témoin : mêmes contraintes, sélection au hasard, turnover maximal."""
    rng = random.Random(seed)
    dates = prices.index
    start = 20
    equity = 1.0
    for i in range(start, len(dates) - rebal_days, rebal_days):
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = [c for c in prices.columns if pd.notna(entry[c]) and pd.notna(exit_[c])]
        if len(valid) < n_hold:
            continue
        picks = rng.sample(valid, n_hold)
        r = ((exit_[picks] - entry[picks]) / entry[picks]).mean() - FEE_ONE_WAY_PCT / 100.0
        equity *= (1 + r)
    return (equity - 1) * 100


def slice_period(df, i, n):
    size = len(df) // n
    return df.iloc[i * size:(i + 1) * size]


if __name__ == "__main__":
    print("Chargement des bougies journalières...", flush=True)
    prices = load_daily()
    rsi = rsi_frame(prices)
    print(f"{prices.shape[1]} paires, {prices.shape[0]} jours "
          f"({prices.index[0].date()} -> {prices.index[-1].date()})\n", flush=True)

    CONFIGS = [(8, 7), (8, 14), (5, 7), (5, 14), (12, 7)]

    print("=== COMPARAISON DIRECTE DES DEUX SIGNES (24 mois, net de frais) ===")
    print(f"{'top':>4} {'rebal':>6} | {'BAS (production)':>18} | {'HAUT (étude JFQA)':>19} | {'écart':>9}")
    results = {}
    for nh, rb in CONFIGS:
        bas = run(prices, rsi, nh, rb, "bas")
        haut = run(prices, rsi, nh, rb, "haut")
        if not bas or not haut:
            continue
        results[(nh, rb)] = (bas, haut)
        print(f"{nh:>4} {rb:>6} | {bas['total']:>17.1f}% | {haut['total']:>18.1f}% | "
              f"{haut['total'] - bas['total']:>+8.1f}pt")

    if not results:
        raise SystemExit("aucune configuration exploitable")

    best_cfg = max(results, key=lambda k: results[k][1]["total"])
    bas, haut = results[best_cfg]
    print(f"\nMeilleure config côté HAUT : top {best_cfg[0]}, rebal {best_cfg[1]}j")
    print(f"  HAUT : {haut['total']:+.1f}% total | {haut['moyenne_par_rebal']:+.3f}%/rebal | "
          f"{haut['positifs']:.0f}% positifs | DD {haut['drawdown']:.1f}% | {haut['trades_par_jour']:.2f} trades/j")
    print(f"  BAS  : {bas['total']:+.1f}% total | {bas['moyenne_par_rebal']:+.3f}%/rebal | "
          f"{bas['positifs']:.0f}% positifs | DD {bas['drawdown']:.1f}%")

    print("\n=== WALK-FORWARD (4 périodes de 6 mois) ===")
    nh, rb = best_cfg
    for side in ("bas", "haut"):
        print(f"\ncôté {side.upper()} :")
        vals = []
        for i in range(N_PERIODS):
            m = run(slice_period(prices, i, N_PERIODS), slice_period(rsi, i, N_PERIODS), nh, rb, side)
            vals.append(m)
            print(f"  P{i+1} : {m['total']:+8.1f}% | {m['positifs']:.0f}% rebal. positifs | DD {m['drawdown']:.1f}%"
                  if m else f"  P{i+1} : période trop courte")
        ok = [v for v in vals if v]
        print(f"  -> positif sur les 4 périodes : "
              f"{'OUI' if len(ok) == N_PERIODS and all(v['total'] > 0 for v in ok) else 'non'}")

    print(f"\n=== TEST DE PERMUTATION ({N_PERMUTATIONS} sélections au hasard) ===")
    print("C'est ce test qui a réfuté le momentum transversal (p = 0,885) alors")
    print("qu'il paraissait excellent. Aucune conclusion sans lui.\n")
    randoms = [run_random(prices, nh, rb, s) for s in range(N_PERMUTATIONS)]
    randoms = [r for r in randoms if r is not None]
    med = sorted(randoms)[len(randoms) // 2]
    for side, m in (("HAUT", haut), ("BAS", bas)):
        better = sum(1 for r in randoms if r >= m["total"])
        p = better / len(randoms)
        verdict = "bat le hasard" if p < 0.05 else "indiscernable du hasard"
        print(f"  {side:>4} : {m['total']:+8.1f}%  |  {better}/{len(randoms)} tirages font mieux  "
              f"|  p = {p:.3f}  ->  {verdict}")
    print(f"\n  Sélection au hasard : moyenne {sum(randoms)/len(randoms):+.1f}%, médiane {med:+.1f}%")
