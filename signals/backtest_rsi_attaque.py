"""
Attaque adverse du résultat RSI transversal : trois façons de le tuer.

Le résultat à abattre. Sur 2020-2026, l'écart « acheter les RSI hauts » moins
« acheter les RSI bas » est positif sur 18 combinaisons de paramètres sur 18,
à +92,5 points par an. La version neutre au marché rend +37,8 %/an avec un
Sharpe autour de 1, reste positive sur 18/18 hors échantillon, et survit à
0,30 % de frais aller-retour avec 11 %/an de portage. C'est de très loin le
meilleur résultat du projet, donc celui qui mérite le plus de méfiance.

Trois attaques, dans l'ordre de létalité :

  1. LE BÊTA. Acheter les RSI hauts sur un univers d'altcoins pendant que le
     marché monte, c'est peut-être juste acheter le marché. Le témoin obligé
     est l'équipondéré acheté-conservé sur le MÊME univers. Si la stratégie ne
     le bat pas, elle ne vaut rien — on peut détenir l'indice sans frais.

  2. LA SIMULTANÉITÉ. Le RSI est calculé sur la clôture du jour i et l'entrée
     se fait à cette même clôture. C'est une hypothèse d'exécution instantanée
     et parfaite. Le test décale l'entrée d'un jour entier : on observe la
     clôture, on n'entre qu'à la clôture suivante. Beaucoup de signaux réputés
     rentables meurent exactement là.

  3. LE BIAIS D'UNIVERS. Les 40 paires sont celles qui sont grosses
     AUJOURD'HUI. En 2020 plusieurs d'entre elles étaient minuscules ; les
     sélectionner revient à connaître à l'avance les gagnants de la décennie.
     Le test restreint l'univers aux seules paires déjà cotées en 2018, donc
     déjà établies au début de la période — un univers beaucoup moins
     contaminé, au prix d'un échantillon plus petit.

Une quatrième vérification, moins spectaculaire mais indispensable : la
répartition du résultat dans le temps. Si tout vient d'un seul trimestre
(typiquement le premier trimestre 2021), il n'y a pas de stratégie, il y a
un accident.

Usage : python backtest_rsi_attaque.py
"""

import itertools

import pandas as pd

from fetch_long_history import load_long_daily
from backtest_rsi_inverse import rsi_frame
from backtest_rsi_long import simulate, FEE_ONE_WAY_PCT

START = "2020-08-11"
RSI_PERIODS = [7, 14, 21]
N_HOLDS = [3, 5, 8]
REBALS = [7, 14]
COMBOS = list(itertools.product(RSI_PERIODS, N_HOLDS, REBALS))


def buy_and_hold(prices, rebal_days=7):
    """
    Témoin de bêta : équipondéré sur tout l'univers, rééquilibré au même
    rythme que la stratégie. Un seul aller-retour de frais au démarrage,
    puis le coût du rééquilibrage, très faible puisque rien ne change de nom.
    """
    dates = prices.index
    equity = [1.0]
    for i in range(25, len(dates) - rebal_days, rebal_days):
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = [c for c in prices.columns if pd.notna(entry[c]) and pd.notna(exit_[c])]
        if not valid:
            continue
        r = ((exit_[valid] - entry[valid]) / entry[valid]).mean()
        equity.append(equity[-1] * (1 + r))
    eq = pd.Series(equity)
    return {
        "total": (eq.iloc[-1] - 1) * 100,
        "annualise": (max(eq.iloc[-1], 1e-9) ** (365.0 / len(dates)) - 1) * 100,
        "drawdown": ((eq - eq.cummax()) / eq.cummax()).min() * 100,
    }


print("Chargement...", flush=True)
full = load_long_daily(verbose=False)
prices = full.loc[START:]
rsis = {p: rsi_frame(prices, p) for p in RSI_PERIODS}
print(f"{prices.shape[1]} paires, {prices.index[0].date()} -> {prices.index[-1].date()}\n")

# ==========================================================================
# ATTAQUE 1 : la stratégie bat-elle le simple fait de détenir l'univers ?
# ==========================================================================
print("=== ATTAQUE 1 : LE BÊTA ===")
print("Détenir l'univers équipondéré coûte zéro effort. Tout ce qui ne le bat")
print("pas est inutile, quel que soit son rendement affiché.\n")
bh = buy_and_hold(prices)
print(f"  Équipondéré acheté-conservé : {bh['annualise']:+.1f} %/an "
      f"({bh['total']:+.0f}% cumulé, DD {bh['drawdown']:.1f}%)\n")

print(f"{'RSI':>4} {'top':>4} {'reb':>4} | {'HAUT long':>11} | {'vs bêta':>9} | "
      f"{'NEUTRE':>10} | {'vs bêta':>9}")
bat_beta_haut = bat_beta_neutre = 0
for rp, nh, rb in COMBOS:
    h = simulate(prices, rsis[rp], nh, rb, "haut")
    n = simulate(prices, rsis[rp], nh, rb, "neutre")
    if not (h and n):
        continue
    dh, dn = h["annualise"] - bh["annualise"], n["annualise"] - bh["annualise"]
    bat_beta_haut += dh > 0
    bat_beta_neutre += dn > 0
    print(f"{rp:>4} {nh:>4} {rb:>4} | {h['annualise']:>9.1f}%a | {dh:>+8.1f}pt | "
          f"{n['annualise']:>8.1f}%a | {dn:>+8.1f}pt")
print(f"\n  HAUT long-only bat le bêta : {bat_beta_haut}/{len(COMBOS)} combinaisons")
print(f"  NEUTRE bat le bêta         : {bat_beta_neutre}/{len(COMBOS)} combinaisons")
print("  (le neutre n'a par construction aucune exposition au marché : le")
print("   comparer au bêta est sévère, mais c'est le vrai choix de l'investisseur)")

# ==========================================================================
# ATTAQUE 2 : décalage d'un jour entre le signal et l'entrée
# ==========================================================================
print("\n=== ATTAQUE 2 : LA SIMULTANÉITÉ ===")
print("Le signal est lu sur la clôture du jour i, mais l'entrée est repoussée")
print("à la clôture du jour i+1. Aucune exécution parfaite, aucun privilège.\n")
rsis_lag = {p: rsis[p].shift(1) for p in RSI_PERIODS}
print(f"{'RSI':>4} {'top':>4} {'reb':>4} | {'sans délai':>12} | {'avec délai':>12} | {'perte':>9}")
survivants = 0
for rp, nh, rb in COMBOS:
    a = simulate(prices, rsis[rp], nh, rb, "neutre")
    b = simulate(prices, rsis_lag[rp], nh, rb, "neutre")
    if not (a and b):
        continue
    survivants += b["annualise"] > 0
    print(f"{rp:>4} {nh:>4} {rb:>4} | {a['annualise']:>10.1f}%a | {b['annualise']:>10.1f}%a | "
          f"{b['annualise'] - a['annualise']:>+8.1f}pt")
print(f"\n  Encore positif avec un jour de retard : {survivants}/{len(COMBOS)} combinaisons")

# ==========================================================================
# ATTAQUE 3 : univers restreint aux paires déjà établies en 2018
# ==========================================================================
print("\n=== ATTAQUE 3 : LE BIAIS D'UNIVERS ===")
old = [c for c in full.columns if full[c].first_valid_index() is not None
       and full[c].first_valid_index().year <= 2019]
print(f"Univers restreint aux {len(old)} paires déjà cotées avant 2020 :")
print(f"  {', '.join(sorted(old))}")
print("Aucune de celles-ci n'a été choisie en connaissant son avenir : elles")
print("étaient déjà établies au début de la période testée.\n")

sub = prices[old]
sub_rsis = {p: rsi_frame(sub, p) for p in RSI_PERIODS}
bh_sub = buy_and_hold(sub)
print(f"  Équipondéré sur cet univers : {bh_sub['annualise']:+.1f} %/an\n")
print(f"{'RSI':>4} {'top':>4} {'reb':>4} | {'BAS':>10} | {'HAUT':>10} | {'écart':>9} | {'NEUTRE':>10}")
pos_sub = 0
ecarts_sub = []
for rp, nh, rb in COMBOS:
    if nh * 2 > len(old):
        continue
    b = simulate(sub, sub_rsis[rp], nh, rb, "bas")
    h = simulate(sub, sub_rsis[rp], nh, rb, "haut")
    n = simulate(sub, sub_rsis[rp], nh, rb, "neutre")
    if not (b and h and n):
        continue
    pos_sub += n["annualise"] > 0
    ecarts_sub.append(h["annualise"] - b["annualise"])
    print(f"{rp:>4} {nh:>4} {rb:>4} | {b['annualise']:>8.1f}%a | {h['annualise']:>8.1f}%a | "
          f"{h['annualise'] - b['annualise']:>+8.1f}pt | {n['annualise']:>8.1f}%a")
if ecarts_sub:
    print(f"\n  Écart HAUT-BAS positif : {sum(1 for e in ecarts_sub if e > 0)}/{len(ecarts_sub)}, "
          f"moyenne {sum(ecarts_sub)/len(ecarts_sub):+.1f} pt/an")
    print(f"  Neutre positif         : {pos_sub}/{len(ecarts_sub)}")

# ==========================================================================
# VÉRIFICATION 4 : le résultat est-il concentré sur un seul trimestre ?
# ==========================================================================
print("\n=== RÉPARTITION TRIMESTRIELLE (neutre, moyenne de toutes les combinaisons) ===")
print("Si tout le gain vient d'un seul trimestre, il n'y a pas de stratégie.\n")
quarters = sorted({(d.year, (d.month - 1) // 3 + 1) for d in prices.index})
rows = []
for y, q in quarters:
    sl = prices[(prices.index.year == y) & ((prices.index.month - 1) // 3 + 1 == q)]
    if len(sl) < 60:
        continue
    vals = [simulate(sl, rsis[rp].loc[sl.index], nh, rb, "neutre") for rp, nh, rb in COMBOS]
    vals = [m["total"] for m in vals if m]
    if vals:
        rows.append((f"{y}T{q}", sum(vals) / len(vals), sum(1 for v in vals if v > 0), len(vals)))

for label, mean, npos, ntot in rows:
    bar = "#" * min(40, int(abs(mean) / 3)) if mean > 0 else "." * min(40, int(abs(mean) / 3))
    print(f"  {label} : {mean:>+7.1f}%  {npos:>2}/{ntot}  {bar}")

pos_q = sum(1 for _, m, _, _ in rows if m > 0)
total_gain = sum(m for _, m, _, _ in rows if m > 0)
best = max(rows, key=lambda r: r[1])
print(f"\n  Trimestres positifs : {pos_q}/{len(rows)}")
print(f"  Meilleur trimestre  : {best[0]} à {best[1]:+.1f}%, soit "
      f"{100 * best[1] / total_gain:.0f}% de la somme des trimestres gagnants")
print(f"  Sans ce trimestre   : {(total_gain - best[1]) / (len(rows) - 1):+.1f}% par trimestre en moyenne")
