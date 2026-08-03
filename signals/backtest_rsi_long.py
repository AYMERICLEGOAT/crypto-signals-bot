"""
Le test du RSI transversal sur 6 ans, avec enfin assez de données.

Ce qui a changé. Tous les backtests précédents tournaient sur 730 jours, soit
104 rééquilibrages hebdomadaires, 52 après découpe hors échantillon. À ce
niveau de bruit rien ne peut être conclu, et l'absence de preuve avait été lue
comme une preuve d'absence. fetch_long_history.py descend maintenant jusqu'à
2017 ; à partir d'août 2020 au moins 20 paires cotent simultanément, ce qui
donne ~312 observations sur six ans couvrant plusieurs régimes complets :
bull 2021, effondrement 2022 (Terra, FTX), reprise 2023, cycle 2024-2026.

Ce qui est testé. Le classement transversal par RSI, dans les deux sens :
  - BAS  : acheter les RSI les plus faibles = la direction en production
  - HAUT : acheter les RSI les plus élevés = la thèse de Fieberg et al. (JFQA
           2024), qui mesurent +3,52 %/semaine sur le quintile haut contre
           +0,00 % sur le quintile bas, sur 3 245 cryptos de 2015 à 2022
  - NEUTRE : long les hauts, short les bas, pour retirer le bêta du marché

Protocole, identique à celui qui a réfuté toutes les pistes précédentes :
frais comptés à 0,10 % l'aller-retour sur les seules positions qui changent,
portage du short facturé, walk-forward par année civile, et surtout témoin
aléatoire à contraintes identiques. Le critère de retenue reste le même :
positif sur TOUTES les périodes indépendantes, et p < 0,05 contre le hasard.

Biais du survivant. Les 40 paires sont celles qui existent aujourd'hui ; les
projets morts sont absents, ce qui gonfle les niveaux. Les écarts entre deux
groupes tirés du même univers biaisé sont en revanche largement immunisés.
Aucune conclusion ne sera tirée d'un niveau, seulement d'un écart.

Usage : python backtest_rsi_long.py
"""

import itertools
import random

import pandas as pd

from fetch_long_history import load_long_daily
from backtest_rsi_inverse import rsi_frame

FEE_ONE_WAY_PCT = 0.05          # 0,10 % l'aller-retour
SHORT_FUNDING_PCT_PER_DAY = 0.01
MIN_PAIRS = 15                   # pas de classement sur un univers trop mince
START = "2020-08-11"             # première date avec >= 20 paires cotées
N_PERMUTATIONS = 400

RSI_PERIODS = [7, 14, 21]
N_HOLDS = [3, 5, 8]
REBALS = [7, 14]


def simulate(prices, rsi, n_hold, rebal_days, mode,
             funding=SHORT_FUNDING_PCT_PER_DAY, fee_one_way=FEE_ONE_WAY_PCT):
    """
    `mode` vaut "haut", "bas" ou "neutre". Long-only pour les deux premiers,
    long/short équilibré pour le troisième.
    """
    dates = prices.index
    start = 25
    if len(dates) <= start + rebal_days:
        return None

    equity = [1.0]
    held_l, held_s = set(), set()
    n_trades = 0
    rets = []

    need = n_hold * 2 if mode == "neutre" else n_hold
    for i in range(start, len(dates) - rebal_days, rebal_days):
        rank = rsi.iloc[i].dropna()
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = rank.index[entry[rank.index].notna() & exit_[rank.index].notna()]
        rank = rank[valid]
        if len(rank) < max(need, MIN_PAIRS):
            continue

        if mode == "neutre":
            longs = set(rank.nlargest(n_hold).index)
            shorts = set(rank.nsmallest(n_hold).index)
        elif mode == "haut":
            longs, shorts = set(rank.nlargest(n_hold).index), set()
        else:
            longs, shorts = set(rank.nsmallest(n_hold).index), set()

        changed = (len(longs - held_l) + len(held_l - longs)
                   + len(shorts - held_s) + len(held_s - shorts))
        n_trades += changed
        fee = (changed / max(1, len(longs) + len(shorts))) * (fee_one_way / 100.0)

        l = list(longs)
        ret_l = ((exit_[l] - entry[l]) / entry[l]).mean()
        if shorts:
            s = list(shorts)
            ret_s = ((entry[s] - exit_[s]) / entry[s]).mean()
            gross = (ret_l + ret_s) / 2
            carry = (funding / 100.0) * rebal_days * 0.5
        else:
            gross, carry = ret_l, 0.0

        r = gross - fee - carry
        rets.append(r)
        equity.append(equity[-1] * (1 + r))
        held_l, held_s = longs, shorts

    if not rets:
        return None
    eq = pd.Series(equity)
    ann = max(eq.iloc[-1], 1e-9) ** (365.0 / max(1, len(dates))) - 1
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / max(1, len(rets) - 1)
    sharpe = (mean / (var ** 0.5) * ((365 / rebal_days) ** 0.5)) if var > 0 else 0.0
    return {
        "total": (eq.iloc[-1] - 1) * 100,
        "annualise": ann * 100,
        "moyenne": mean * 100,
        "sharpe": sharpe,
        "positifs": 100 * sum(1 for r in rets if r > 0) / len(rets),
        "drawdown": ((eq - eq.cummax()) / eq.cummax()).min() * 100,
        "trades_par_jour": n_trades / max(1, len(dates) - start),
        "n_rebal": len(rets),
    }


def simulate_random(prices, n_hold, rebal_days, seed, mode, funding=SHORT_FUNDING_PCT_PER_DAY):
    """Témoin : mêmes contraintes, mêmes coûts, paires tirées au sort."""
    rng = random.Random(seed)
    dates = prices.index
    start = 25
    if len(dates) <= start + rebal_days:
        return None
    equity = 1.0
    need = n_hold * 2 if mode == "neutre" else n_hold
    for i in range(start, len(dates) - rebal_days, rebal_days):
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = [c for c in prices.columns if pd.notna(entry[c]) and pd.notna(exit_[c])]
        if len(valid) < max(need, MIN_PAIRS):
            continue
        picked = rng.sample(valid, need)
        if mode == "neutre":
            l, s = picked[:n_hold], picked[n_hold:]
            ret_l = ((exit_[l] - entry[l]) / entry[l]).mean()
            ret_s = ((entry[s] - exit_[s]) / entry[s]).mean()
            gross = (ret_l + ret_s) / 2
            carry = (funding / 100.0) * rebal_days * 0.5
        else:
            l = picked
            gross = ((exit_[l] - entry[l]) / entry[l]).mean()
            carry = 0.0
        equity *= (1 + gross - FEE_ONE_WAY_PCT / 100.0 - carry)
    return (equity - 1) * 100


if __name__ == "__main__":
    print("Chargement de l'historique long...", flush=True)
    prices = load_long_daily(verbose=False)
    prices = prices.loc[START:]
    print(f"{prices.shape[1]} paires, {prices.shape[0]} jours "
          f"({prices.index[0].date()} -> {prices.index[-1].date()})")
    print(f"Paires cotées : {prices.notna().sum(axis=1).min()} au minimum, "
          f"{prices.notna().sum(axis=1).max()} au maximum\n", flush=True)

    rsis = {p: rsi_frame(prices, p) for p in RSI_PERIODS}
    combos = list(itertools.product(RSI_PERIODS, N_HOLDS, REBALS))

    # --- 1. Les deux sens, sur toute la période ---
    print("=== LES DEUX SENS DU RSI, 6 ANS, NET DE FRAIS ===")
    print(f"{'RSI':>4} {'top':>4} {'reb':>4} | {'BAS (prod)':>12} | {'HAUT (JFQA)':>12} | "
          f"{'écart':>9} | {'NEUTRE':>10} | {'Sharpe':>7}")
    table = {}
    for rp, nh, rb in combos:
        bas = simulate(prices, rsis[rp], nh, rb, "bas")
        haut = simulate(prices, rsis[rp], nh, rb, "haut")
        neu = simulate(prices, rsis[rp], nh, rb, "neutre")
        if not (bas and haut and neu):
            continue
        table[(rp, nh, rb)] = (bas, haut, neu)
        print(f"{rp:>4} {nh:>4} {rb:>4} | {bas['annualise']:>10.1f}%a | {haut['annualise']:>10.1f}%a | "
              f"{haut['annualise'] - bas['annualise']:>+8.1f}pt | {neu['annualise']:>8.1f}%a | "
              f"{neu['sharpe']:>7.2f}")

    ecarts = [h["annualise"] - b["annualise"] for b, h, _ in table.values()]
    neutres = [n["annualise"] for _, _, n in table.values()]
    print(f"\n  Écart HAUT - BAS : positif sur {sum(1 for e in ecarts if e > 0)}/{len(ecarts)} "
          f"combinaisons | moyenne {sum(ecarts)/len(ecarts):+.1f} pt/an")
    print(f"  Neutre           : positif sur {sum(1 for n in neutres if n > 0)}/{len(neutres)} "
          f"combinaisons | moyenne {sum(neutres)/len(neutres):+.1f} %/an")

    # --- 2. Walk-forward par année civile : le vrai juge ---
    print("\n=== WALK-FORWARD PAR ANNÉE CIVILE (mode neutre) ===")
    print("Un avantage réel n'a pas besoin d'un réglage fin : la MOYENNE de toutes")
    print("les combinaisons est reportée, pas la meilleure d'entre elles.\n")
    years = sorted({d.year for d in prices.index})
    print(f"{'année':>6} | {'moyenne':>9} | {'médiane':>9} | {'positives':>10} | {'meilleure':>10} | {'pire':>9}")
    year_means = []
    for y in years:
        sl = prices[prices.index.year == y]
        if len(sl) < 90:
            continue
        vals = []
        for rp, nh, rb in combos:
            m = simulate(sl, rsis[rp].loc[sl.index], nh, rb, "neutre")
            if m:
                vals.append(m["total"])
        if not vals:
            continue
        year_means.append((y, sum(vals) / len(vals)))
        print(f"{y:>6} | {sum(vals)/len(vals):>+8.1f}% | {sorted(vals)[len(vals)//2]:>+8.1f}% | "
              f"{sum(1 for v in vals if v > 0):>4}/{len(vals):<5} | {max(vals):>+9.1f}% | {min(vals):>+8.1f}%")

    n_pos_years = sum(1 for _, m in year_means if m > 0)
    print(f"\n  -> positif sur {n_pos_years}/{len(year_means)} années civiles")

    # --- 3. Hors échantillon strict : 2020-2023 pour choisir, 2024-2026 pour juger ---
    split = "2024-01-01"
    in_s, out_s = prices.loc[:split], prices.loc[split:]
    scored = []
    for rp, nh, rb in combos:
        m = simulate(in_s, rsis[rp].loc[in_s.index], nh, rb, "neutre")
        if m:
            scored.append(((rp, nh, rb), m["annualise"]))
    scored.sort(key=lambda x: -x[1])
    best, best_is = scored[0]
    rp, nh, rb = best
    print(f"\n=== HORS ÉCHANTILLON STRICT ===")
    print(f"Sélection sur {in_s.index[0].date()} -> {in_s.index[-1].date()} : "
          f"RSI({rp}) / top {nh} / rebal {rb}j -> {best_is:+.1f} %/an")
    oos = simulate(out_s, rsis[rp].loc[out_s.index], nh, rb, "neutre")
    if oos:
        print(f"Appliqué à {out_s.index[0].date()} -> {out_s.index[-1].date()} : "
              f"{oos['annualise']:+.1f} %/an ({oos['total']:+.1f}% cumulé)")
        print(f"  Sharpe {oos['sharpe']:.2f} | {oos['positifs']:.0f}% de rééquilibrages positifs | "
              f"DD {oos['drawdown']:.1f}% | {oos['n_rebal']} rééquilibrages")

    oos_all = [simulate(out_s, rsis[a].loc[out_s.index], b, c, "neutre") for a, b, c in combos]
    oos_all = [m["annualise"] for m in oos_all if m]
    print(f"Toute la région hors échantillon : {sum(1 for t in oos_all if t > 0)}/{len(oos_all)} positives, "
          f"moyenne {sum(oos_all)/len(oos_all):+.1f} %/an")

    # --- 4. Permutation, sur la période hors échantillon ---
    print(f"\n=== TEST DE PERMUTATION ({N_PERMUTATIONS} tirages, hors échantillon) ===")
    randoms = [simulate_random(out_s, nh, rb, s, "neutre") for s in range(N_PERMUTATIONS)]
    randoms = [r for r in randoms if r is not None]
    if randoms and oos:
        better = sum(1 for r in randoms if r >= oos["total"])
        p = better / len(randoms)
        print(f"  Tirage au sort : moyenne {sum(randoms)/len(randoms):+.1f}%, "
              f"médiane {sorted(randoms)[len(randoms)//2]:+.1f}%")
        print(f"  Classement RSI : {oos['total']:+.1f}%")
        print(f"  {better}/{len(randoms)} tirages font aussi bien ou mieux  ->  p = {p:.3f}")
        print(f"  {'>>> BAT LE HASARD' if p < 0.05 else 'indiscernable du hasard'}")

    # --- 5. Sensibilité aux coûts, le test que rien n'a passé jusqu'ici ---
    print(f"\n=== SENSIBILITÉ AUX COÛTS (RSI({rp}) / top {nh} / rebal {rb}j, 6 ans) ===")
    print(f"{'frais A/R':>10} | {'funding':>16} | {'annualisé':>10}")
    for fee_rt in (0.10, 0.20, 0.30):
        for fund in (0.00, 0.01, 0.03):
            m = simulate(prices, rsis[rp], nh, rb, "neutre",
                         funding=fund, fee_one_way=fee_rt / 2)
            if m:
                print(f"{fee_rt:>9.2f}% | {fund:>6.2f} %/j ({fund*365:>4.0f}%/an) | "
                      f"{m['annualise']:>+9.1f}%")
