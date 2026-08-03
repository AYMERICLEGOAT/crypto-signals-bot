"""
Le test décisif : l'écart RSI haut / RSI bas, débarrassé du marché.

Ce que backtest_rsi_inverse.py a établi. Sur 24 mois et 40 paires, acheter
les RSI les plus ÉLEVÉS bat acheter les plus FAIBLES sur les 5 configurations
testées, de +21,8 à +59,8 points. Le côté haut passe le test de permutation
(p = 0,023) ; le côté bas, qui est la direction en production, ne le passe pas
(p = 0,567). Mais les deux perdent en absolu, parce que le témoin aléatoire
perd -57,6 % : l'univers s'est effondré. C'est le bêta qui écrase tout.

D'où ce module. Si le classement RSI porte réellement de l'information, alors
la position « long les RSI hauts, short les RSI bas » doit capturer l'écart
sans subir la direction du marché.

Trois pièges à éviter, tous rencontrés plus tôt dans ce projet :

  1. Le surapprentissage par sélection post-hoc. Les paramètres sont donc
     choisis sur les 12 premiers mois seulement, puis appliqués tels quels
     aux 12 derniers, jamais regardés pendant la sélection.

  2. L'illusion du classement. Le témoin aléatoire neutre (mêmes contraintes,
     paires tirées au sort) doit être battu. Sans lui, le momentum transversal
     paraissait excellent sur 17 combinaisons sur 18 — et ne valait rien.

  3. Le coût réel du short. Un short en crypto paie un funding toutes les
     8 heures, souvent positif (le short encaisse) mais parfois violemment
     négatif. Il est facturé ici à une hypothèse défavorable et constante,
     puis testé en sensibilité : si l'avantage ne survit qu'à funding nul,
     il n'existe pas.

Usage : python backtest_rsi_neutral.py
"""

import itertools
import random

import pandas as pd

from backtest_cross_momentum import load_daily, FEE_ONE_WAY_PCT
from backtest_rsi_inverse import rsi_frame

N_PERMUTATIONS = 300
# Coût de portage du short, en % par jour, à la charge de la stratégie.
# 0,01 %/j = 3,65 %/an, ce qui est pessimiste : historiquement le funding
# des perpétuels est majoritairement positif, donc encaissé par le short.
SHORT_FUNDING_PCT_PER_DAY = 0.01

RSI_PERIODS = [7, 14, 21]
N_HOLDS = [3, 5, 8]
REBALS = [7, 14]


def simulate_neutral(prices, rsi, n_hold, rebal_days, funding=SHORT_FUNDING_PCT_PER_DAY):
    """
    Long les `n_hold` RSI les plus élevés, short les `n_hold` plus faibles,
    équipondéré, rééquilibré tous les `rebal_days` jours.

    Les frais sont comptés sur les deux jambes et sur les seules positions qui
    changent réellement d'un rééquilibrage au suivant. Le portage du short est
    facturé sur toute la durée de détention.
    """
    dates = prices.index
    start = 25
    if len(dates) <= start + rebal_days:
        return None

    equity = [1.0]
    held_l, held_s = set(), set()
    n_trades = 0
    rets = []

    for i in range(start, len(dates) - rebal_days, rebal_days):
        rank = rsi.iloc[i].dropna()
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = rank.index[entry[rank.index].notna() & exit_[rank.index].notna()]
        rank = rank[valid]
        if len(rank) < n_hold * 2:
            continue

        longs = set(rank.nlargest(n_hold).index)
        shorts = set(rank.nsmallest(n_hold).index)
        changed = (len(longs - held_l) + len(held_l - longs)
                   + len(shorts - held_s) + len(held_s - shorts))
        n_trades += changed
        fee = (changed / max(1, n_hold * 2)) * (FEE_ONE_WAY_PCT / 100.0)

        l, s = list(longs), list(shorts)
        ret_l = ((exit_[l] - entry[l]) / entry[l]).mean()
        ret_s = ((entry[s] - exit_[s]) / entry[s]).mean()
        carry = (funding / 100.0) * rebal_days * 0.5  # half the book is short

        r = (ret_l + ret_s) / 2 - fee - carry
        rets.append(r)
        equity.append(equity[-1] * (1 + r))
        held_l, held_s = longs, shorts

    if not rets:
        return None
    eq = pd.Series(equity)
    return {
        "total": (eq.iloc[-1] - 1) * 100,
        "moyenne": sum(rets) / len(rets) * 100,
        "positifs": 100 * sum(1 for r in rets if r > 0) / len(rets),
        "drawdown": ((eq - eq.cummax()) / eq.cummax()).min() * 100,
        "trades_par_jour": n_trades / max(1, len(dates) - start),
        "n_rebal": len(rets),
    }


def random_neutral(prices, n_hold, rebal_days, seed, funding=SHORT_FUNDING_PCT_PER_DAY):
    """Témoin : mêmes contraintes et mêmes coûts, paires tirées au hasard."""
    rng = random.Random(seed)
    dates = prices.index
    start = 25
    if len(dates) <= start + rebal_days:
        return None
    equity = 1.0
    for i in range(start, len(dates) - rebal_days, rebal_days):
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = [c for c in prices.columns if pd.notna(entry[c]) and pd.notna(exit_[c])]
        if len(valid) < n_hold * 2:
            continue
        picked = rng.sample(valid, n_hold * 2)
        l, s = picked[:n_hold], picked[n_hold:]
        ret_l = ((exit_[l] - entry[l]) / entry[l]).mean()
        ret_s = ((entry[s] - exit_[s]) / entry[s]).mean()
        equity *= (1 + (ret_l + ret_s) / 2
                   - FEE_ONE_WAY_PCT / 100.0
                   - (funding / 100.0) * rebal_days * 0.5)
    return (equity - 1) * 100


print("Chargement...", flush=True)
prices = load_daily()
mid = len(prices) // 2
print(f"{prices.shape[1]} paires, {prices.shape[0]} jours "
      f"({prices.index[0].date()} -> {prices.index[-1].date()})")
print(f"  Sélection : {prices.index[0].date()} -> {prices.index[mid - 1].date()}")
print(f"  Test      : {prices.index[mid].date()} -> {prices.index[-1].date()}\n", flush=True)

rsis = {p: rsi_frame(prices, p) for p in RSI_PERIODS}
combos = list(itertools.product(RSI_PERIODS, N_HOLDS, REBALS))

# --- 1. Balayage complet, pour voir si l'avantage est diffus ou ponctuel ---
print("=== BALAYAGE COMPLET SUR 24 MOIS (net de frais et de portage) ===")
print(f"{'RSI':>4} {'top':>4} {'rebal':>6} | {'total':>9} | {'%/rebal':>8} | {'positifs':>9} | {'DD':>7}")
full = {}
for rp, nh, rb in combos:
    m = simulate_neutral(prices, rsis[rp], nh, rb)
    if not m:
        continue
    full[(rp, nh, rb)] = m
    print(f"{rp:>4} {nh:>4} {rb:>6} | {m['total']:>8.1f}% | {m['moyenne']:>+7.3f}% | "
          f"{m['positifs']:>8.0f}% | {m['drawdown']:>6.1f}%")

totals = [m["total"] for m in full.values()]
pos = sum(1 for t in totals if t > 0)
print(f"\n  {pos}/{len(totals)} combinaisons positives  |  "
      f"moyenne {sum(totals)/len(totals):+.1f}%  |  médiane {sorted(totals)[len(totals)//2]:+.1f}%")

# --- 2. Sélection sur la 1re moitié, test sur la 2e jamais regardée ---
in_s, out_s = prices.iloc[:mid], prices.iloc[mid:]
scored = []
for rp, nh, rb in combos:
    m = simulate_neutral(in_s, rsis[rp].iloc[:mid], nh, rb)
    if m:
        scored.append(((rp, nh, rb), m["total"]))
scored.sort(key=lambda x: -x[1])
best, best_is = scored[0]
rp, nh, rb = best

print(f"\n=== HORS ÉCHANTILLON STRICT ===")
print(f"Meilleur jeu sur la période de sélection : RSI({rp}) / top {nh} / rebal {rb}j "
      f"-> {best_is:+.1f}%")
oos = simulate_neutral(out_s, rsis[rp].iloc[mid:], nh, rb)
if oos:
    print(f"Appliqué tel quel à la période de test  : {oos['total']:+.1f}% net")
    print(f"  {oos['positifs']:.0f}% de rééquilibrages positifs | DD {oos['drawdown']:.1f}% | "
          f"{oos['trades_par_jour']:.2f} trades/jour | {oos['n_rebal']} rééquilibrages")

# La région entière hors échantillon : un edge réel ne tient pas à un réglage.
oos_all = [simulate_neutral(out_s, rsis[a].iloc[mid:], b, c) for a, b, c in combos]
oos_all = [m["total"] for m in oos_all if m]
print(f"\nToute la région, hors échantillon : {sum(1 for t in oos_all if t > 0)}/{len(oos_all)} positives, "
      f"moyenne {sum(oos_all)/len(oos_all):+.1f}%, médiane {sorted(oos_all)[len(oos_all)//2]:+.1f}%")

# --- 3. Walk-forward sur 4 périodes indépendantes ---
print(f"\n=== WALK-FORWARD, RSI({rp}) / top {nh} / rebal {rb}j ===")
size = len(prices) // 4
wf = []
for i in range(4):
    sl = slice(i * size, (i + 1) * size)
    m = simulate_neutral(prices.iloc[sl], rsis[rp].iloc[sl], nh, rb)
    wf.append(m)
    if m:
        print(f"  P{i+1} ({prices.index[i*size].date()} -> {prices.index[(i+1)*size-1].date()}) : "
              f"{m['total']:+8.1f}% | {m['positifs']:.0f}% positifs | DD {m['drawdown']:.1f}%")
ok = [m for m in wf if m]
all_pos = len(ok) == 4 and all(m["total"] > 0 for m in ok)
print(f"  -> positif sur les 4 périodes : {'OUI' if all_pos else 'NON'}")

# --- 4. Permutation : le classement RSI bat-il un tirage au sort ? ---
print(f"\n=== TEST DE PERMUTATION ({N_PERMUTATIONS} tirages, hors échantillon) ===")
randoms = [random_neutral(out_s, nh, rb, s) for s in range(N_PERMUTATIONS)]
randoms = [r for r in randoms if r is not None]
if randoms and oos:
    better = sum(1 for r in randoms if r >= oos["total"])
    p = better / len(randoms)
    print(f"  Tirage au sort : moyenne {sum(randoms)/len(randoms):+.1f}%, "
          f"médiane {sorted(randoms)[len(randoms)//2]:+.1f}%")
    print(f"  Classement RSI : {oos['total']:+.1f}%")
    print(f"  {better}/{len(randoms)} tirages font aussi bien ou mieux  ->  p = {p:.3f}")
    print(f"  {'BAT LE HASARD' if p < 0.05 else 'indiscernable du hasard'}")

# --- 5. Sensibilité au coût de portage du short ---
print(f"\n=== SENSIBILITÉ AU FUNDING DU SHORT (période de test) ===")
print("Si l'avantage ne survit qu'à funding nul, il n'est pas exploitable.")
for f in (0.0, 0.01, 0.02, 0.05, 0.10):
    m = simulate_neutral(out_s, rsis[rp].iloc[mid:], nh, rb, funding=f)
    if m:
        print(f"  {f:.2f} %/jour ({f*365:>5.1f} %/an) : {m['total']:+8.1f}%")
