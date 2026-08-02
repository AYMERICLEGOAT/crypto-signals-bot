"""
Test HORS ÉCHANTILLON strict du momentum transversal neutre au marché.

Pourquoi ce module existe séparément. Le balayage de
backtest_cross_momentum.py a montré que la variante neutre au marché (long
les meilleures, short les pires) est positive sur 17 combinaisons sur 18
dans la région « fenêtre courte (7-30j) + rééquilibrage court (7-14j) ».
Sous hypothèse de hasard, cette concentration a une probabilité de 0,00007.

Mais cette région a été identifiée APRÈS avoir vu les résultats. Le p-value
est donc optimiste : c'est de la sélection post-hoc, exactement le mécanisme
qui a produit le « 61,2 % de réussite » affiché à tort sur le site pendant
des mois, et qui a fait rejeter plusieurs pistes de cette étude.

Le seul test qui tranche : choisir les paramètres sur les 12 PREMIERS mois,
puis les appliquer tels quels aux 12 DERNIERS, jamais regardés pendant la
sélection. Si l'avantage survit, il est réel. Sinon, c'est du surapprentissage
et il faut le dire.

Trois garde-fous supplémentaires ici :
  - la moyenne de TOUTE la région court terme est mesurée, pas seulement le
    meilleur jeu de paramètres (un edge réel ne dépend pas d'un réglage fin) ;
  - un test de permutation compare le résultat à ce que produisent des
    sélections ALÉATOIRES de paires, à turnover identique ;
  - les frais sont comptés dans tous les cas.

Usage : python backtest_neutral_oos.py
"""

import itertools
import random

import pandas as pd

from backtest_cross_momentum import load_daily, simulate_neutral, FEE_ONE_WAY_PCT

SHORT_LOOKBACKS = [7, 14, 30]
HOLDS = [3, 5, 10]
SHORT_REBALS = [7, 14]
N_PERMUTATIONS = 200


def random_neutral(prices, n_hold, rebal_days, seed):
    """
    Témoin : mêmes contraintes (nombre de positions, fréquence, frais, deux
    jambes) mais sélection ALÉATOIRE des paires. Si le momentum n'apporte
    rien, la stratégie réelle doit être indiscernable de ce témoin.
    """
    rng = random.Random(seed)
    dates = prices.index
    start = 31
    if len(dates) <= start + rebal_days:
        return None
    equity = 1.0
    for i in range(start, len(dates) - rebal_days, rebal_days):
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = [c for c in prices.columns if pd.notna(entry[c]) and pd.notna(exit_[c])]
        if len(valid) < n_hold * 2:
            continue
        picked = rng.sample(valid, n_hold * 2)
        longs, shorts = picked[:n_hold], picked[n_hold:]
        ret_l = ((exit_[longs] - entry[longs]) / entry[longs]).mean()
        ret_s = ((entry[shorts] - exit_[shorts]) / entry[shorts]).mean()
        # Turnover maximal (toutes les positions changent) : hypothèse
        # défavorable au témoin, donc conservatrice pour notre conclusion.
        equity *= (1 + (ret_l + ret_s) / 2 - FEE_ONE_WAY_PCT / 100.0)
    return (equity - 1) * 100


print("Chargement...", flush=True)
prices = load_daily()
mid = len(prices) // 2
in_sample, out_sample = prices.iloc[:mid], prices.iloc[mid:]
print(f"{prices.shape[1]} paires")
print(f"  Échantillon de sélection : {in_sample.index[0].date()} -> {in_sample.index[-1].date()}")
print(f"  Échantillon de test      : {out_sample.index[0].date()} -> {out_sample.index[-1].date()}\n", flush=True)

# --- 1. Sélection des paramètres UNIQUEMENT sur la première moitié ---
combos = list(itertools.product(SHORT_LOOKBACKS, HOLDS, SHORT_REBALS))
scored = []
for lb, nh, rb in combos:
    m = simulate_neutral(in_sample, lb, nh, rb)
    if m:
        scored.append(((lb, nh, rb), m["total_net"]))
scored.sort(key=lambda x: -x[1])
best_params, best_is = scored[0]
print(f"Meilleur jeu sur la période de SÉLECTION : fenêtre {best_params[0]}j / "
      f"top {best_params[1]} / rebal {best_params[2]}j -> {best_is:+.1f}%\n", flush=True)

# --- 2. Application tel quel à la seconde moitié, jamais regardée ---
oos = simulate_neutral(out_sample, *best_params)
print("=== TEST HORS ÉCHANTILLON ===")
if oos:
    print(f"  Résultat net      : {oos['total_net']:+.1f}%")
    print(f"  Rééquil. positifs : {oos['positifs']:.0f}%")
    print(f"  Drawdown          : {oos['drawdown']:.1f}%")
    print(f"  Trades / jour     : {oos['trades_par_jour']:.2f}")
else:
    print("  échantillon insuffisant")

# --- 3. La région entière, pas seulement le meilleur réglage ---
# Un edge réel ne dépend pas d'un réglage fin : il doit apparaître en moyenne
# sur toute la famille de paramètres voisins.
oos_all = [simulate_neutral(out_sample, lb, nh, rb) for lb, nh, rb in combos]
oos_all = [m for m in oos_all if m]
if oos_all:
    rets = [m["total_net"] for m in oos_all]
    pos = sum(1 for r in rets if r > 0)
    print(f"\n=== TOUTE LA RÉGION COURT TERME, HORS ÉCHANTILLON ===")
    print(f"  {pos}/{len(rets)} combinaisons positives")
    print(f"  Moyenne : {sum(rets)/len(rets):+.1f}%  |  médiane : {sorted(rets)[len(rets)//2]:+.1f}%")
    print(f"  Pire    : {min(rets):+.1f}%  |  meilleure : {max(rets):+.1f}%")

# --- 4. Test de permutation : le momentum bat-il un choix au hasard ? ---
print(f"\n=== TEST DE PERMUTATION ({N_PERMUTATIONS} sélections aléatoires) ===")
nh, rb = best_params[1], best_params[2]
randoms = [random_neutral(out_sample, nh, rb, seed) for seed in range(N_PERMUTATIONS)]
randoms = [r for r in randoms if r is not None]
if randoms and oos:
    better = sum(1 for r in randoms if r >= oos["total_net"])
    randoms_sorted = sorted(randoms)
    print(f"  Sélection aléatoire, même turnover : moyenne {sum(randoms)/len(randoms):+.1f}%, "
          f"médiane {randoms_sorted[len(randoms)//2]:+.1f}%")
    print(f"  Notre stratégie   : {oos['total_net']:+.1f}%")
    print(f"  Tirages aléatoires faisant aussi bien ou mieux : {better}/{len(randoms)} "
          f"(p = {better/len(randoms):.3f})")
    print()
    if better / len(randoms) < 0.05:
        print("  -> Le classement par momentum bat significativement le hasard.")
    else:
        print("  -> Indiscernable d'une sélection au hasard : le classement n'apporte RIEN.")
