"""
Filtre de tendance absolue : ne trader que quand le marché lui-même monte.

Le problème à résoudre. Le classement par force relative bat la direction en
production sur 5 années sur 7 et produit 6 signaux par semaine à +1,70 %
d'espérance sur l'ensemble de la période. Mais son espérance annuelle n'est
positive que 4 années sur 7 : +6,9 % en 2020, +5,8 % en 2021, -1,6 % en 2022,
+2,6 % en 2023, +2,6 % en 2024, -0,4 % en 2025, -2,2 % en 2026. Il gagne en
marché haussier et perd en marché baissier — dont la période actuelle.

La solution n'est pas inventée à partir de ces données. Elle porte un nom,
« dual momentum » (Antonacci, 2014), et elle combine deux briques distinctes :

  - momentum RELATIF : parmi les actifs, lesquels sont les plus forts ?
    C'est ce qui est déjà validé ici.
  - momentum ABSOLU : le marché lui-même est-il orienté à la hausse ?
    Si non, on ne prend aucune position, quelle que soit la force relative.

C'est important de le souligner : le filtre absolu est une règle antérieure et
extérieure au projet, pas un paramètre choisi parce qu'il faisait bien sur ces
7 années. C'est la différence entre appliquer une règle connue et bricoler
jusqu'à ce que la courbe soit belle — cette dernière méthode ayant déjà produit
le « 61,2 % de réussite » affiché à tort pendant des mois.

Trois variantes de filtre sont comparées, aucune n'étant réglée finement :
  - BTC au-dessus de sa moyenne mobile 200 jours (la référence du domaine)
  - BTC au-dessus de sa moyenne mobile 100 jours (plus réactif)
  - l'indice équipondéré de l'univers au-dessus de sa moyenne 100 jours

Le coût du filtre est mesuré explicitement : il supprime des signaux, donc du
chiffre d'affaires potentiel. La question n'est pas « améliore-t-il le
rendement » mais « le gain de qualité paie-t-il la perte de quantité ».

Usage : python backtest_dual_momentum.py
"""

import pandas as pd

from fetch_long_history import load_long_daily
from backtest_rsi_inverse import rsi_frame
from backtest_rsi_production import collect_signals, stats, FEE_ROUND_TRIP_PCT

START = "2020-08-11"


def apply_filter(signals, mask):
    """Ne garde que les signaux émis un jour où le filtre est ouvert."""
    if signals.empty:
        return signals
    keep = signals["date"].map(lambda d: bool(mask.get(d, False)))
    return signals[keep]


def yearly(sig, label):
    if sig.empty:
        print(f"  {label} : aucun signal")
        return []
    out = []
    for y in sorted(sig["date"].dt.year.unique()):
        a = sig[sig["date"].dt.year == y]["gain_pct"]
        out.append((y, len(a), 100 * (a > 0).mean(), a.mean()))
    return out


print("Chargement...", flush=True)
full = load_long_daily(verbose=False)
prices = full.loc[START:]
n_days = len(prices)

old = [c for c in full.columns
       if full[c].first_valid_index() is not None and full[c].first_valid_index().year <= 2019]
sub = prices[old]
rsi21 = rsi_frame(sub, 21)

# L'historique complet sert à calculer les moyennes mobiles sans trou au début.
btc = full["BTC/USDT"]
index_ew = full[old].pct_change().mean(axis=1).add(1).cumprod()

FILTERS = {
    "aucun (référence)": None,
    "BTC > MM200": (btc > btc.rolling(200).mean()),
    "BTC > MM100": (btc > btc.rolling(100).mean()),
    "indice équipondéré > MM100": (index_ew > index_ew.rolling(100).mean()),
}

N_HOLD, HOLD_DAYS = 5, 7
base = collect_signals(sub, rsi21, N_HOLD, HOLD_DAYS)

print(f"{sub.shape[1]} paires pré-2020, {prices.index[0].date()} -> {prices.index[-1].date()}")
print(f"Configuration : top {N_HOLD} par force relative, détention {HOLD_DAYS} jours, "
      f"délai 1 jour, frais {FEE_ROUND_TRIP_PCT:.2f} % A/R\n")

print("=== EFFET DE CHAQUE FILTRE SUR L'ENSEMBLE DE LA PÉRIODE ===")
print(f"{'filtre':>28} | {'sig/sem':>8} | {'réussite':>9} | {'espérance':>11} | "
      f"{'% du temps ouvert':>18}")
kept = {}
for name, mask in FILTERS.items():
    if mask is None:
        sig, open_pct = base, 100.0
    else:
        m = mask.reindex(prices.index).fillna(False).to_dict()
        sig = apply_filter(base, m)
        open_pct = 100 * sum(1 for d in prices.index if m.get(d, False)) / len(prices)
    kept[name] = sig
    s = stats(sig, n_days)
    if s:
        print(f"{name:>28} | {s['par_semaine']:>7.1f}  | {s['reussite']:>8.1f}% | "
              f"{s['esperance']:>+10.2f}% | {open_pct:>17.0f}%")

print("\n=== ANNÉE PAR ANNÉE, LE SEUL JUGE QUI COMPTE ===")
print("Le filtre doit transformer les années perdantes en années SANS TRADE,")
print("pas seulement améliorer une moyenne.\n")
for name in FILTERS:
    rows = yearly(kept[name], name)
    if not rows:
        continue
    n_pos = sum(1 for _, _, _, e in rows if e > 0)
    print(f"  {name}  ->  espérance positive sur {n_pos}/{len(rows)} années")
    line = "    "
    for y, n, w, e in rows:
        line += f"{y}: {e:+.2f}% ({n:>3} sig)   "
    print(line)
    print()

# --- Le coût du filtre, en clair ---
print("=== CE QUE COÛTE LE FILTRE ===")
print("Moins de signaux, c'est moins de contenu pour le canal et moins de")
print("raisons de rester abonné. Le calcul doit être fait, pas éludé.\n")
ref = stats(base, n_days)
print(f"{'filtre':>28} | {'signaux perdus':>15} | {'gain espérance':>18} | {'verdict':>28}")
for name, sig in kept.items():
    if name.startswith("aucun"):
        continue
    s = stats(sig, n_days)
    if not s:
        continue
    perte = 100 * (1 - s["n"] / ref["n"])
    gain = s["esperance"] - ref["esperance"]
    rows = yearly(sig, name)
    n_pos = sum(1 for _, _, _, e in rows if e > 0)
    verdict = f"{n_pos}/{len(rows)} années positives"
    print(f"{name:>28} | {perte:>14.0f}% | {gain:>+17.2f}pt | {verdict:>28}")

# --- Variante : plus de positions pour compenser la perte de quantité ---
print("\n=== COMPENSER LA PERTE DE QUANTITÉ EN ÉLARGISSANT LE GROUPE DE TÊTE ===")
print("Avec un filtre en place, on peut se permettre d'être moins sélectif sur")
print("le classement sans dégrader la qualité : le filtre fait déjà le tri.\n")
best_mask = (btc > btc.rolling(200).mean()).reindex(prices.index).fillna(False).to_dict()
print(f"{'top':>5} {'détention':>10} | {'sig/sem':>8} | {'réussite':>9} | {'espérance':>11} | "
      f"{'années +':>9}")
for nh in (5, 8, 12, 18):
    for hold in (7, 14):
        sig = apply_filter(collect_signals(sub, rsi21, nh, hold), best_mask)
        s = stats(sig, n_days)
        if not s or s["n"] < 50:
            continue
        rows = yearly(sig, "")
        n_pos = sum(1 for _, _, _, e in rows if e > 0)
        print(f"{nh:>5} {hold:>9}j | {s['par_semaine']:>7.1f}  | {s['reussite']:>8.1f}% | "
              f"{s['esperance']:>+10.2f}% | {n_pos:>4}/{len(rows):<4}")
