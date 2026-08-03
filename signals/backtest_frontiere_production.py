"""
Combien de signaux peut-on émettre sans casser la qualité ?

La question posée. Les mesures précédentes portaient sur l'univers restreint
aux 18 paires cotées avant 2020, choisi pour éliminer le biais du survivant.
C'était le bon univers pour ÉTABLIR l'avantage. Ce n'est pas celui de la
production, qui suit 40 paires. Sur 40 paires, « top 5 » sélectionne les 12,5 %
les plus forts, contre 28 % sur 18 paires — ce n'est pas la même sélectivité,
donc pas la même quantité ni la même qualité.

Trois choses sont mesurées ici, et elles décident du réglage livré :

  1. La FRONTIÈRE quantité/qualité sur l'univers de production. Pour chaque
     couple (nombre de positions, durée de détention) : signaux par semaine,
     taux de réussite, espérance nette, et nombre d'années positives. On veut
     le maximum de signaux compatible avec une qualité qui tient.

  2. L'EXPOSITION GRADUÉE. Le filtre binaire (BTC au-dessus ou en dessous de sa
     MM200) coupe tout d'un coup. Une alternative naturelle est de moduler le
     nombre de positions selon la distance à la moyenne : pleine exposition
     quand le marché est franchement au-dessus, exposition réduite quand il est
     juste au-dessus. Si ça n'apporte rien, on garde le binaire — plus simple à
     expliquer aux abonnés, et une règle de moins à sur-ajuster.

  3. Le COÛT DU BIAIS. Les mêmes réglages sont mesurés sur les deux univers.
     Si l'écart est énorme, c'est que le résultat production repose sur des
     paires choisies en connaissant leur avenir, et il faut communiquer sur les
     chiffres de l'univers propre, pas sur les flatteurs.

Toutes les mesures : filtre BTC > MM200, entrée décalée d'un jour, 0,10 % de
frais aller-retour, sortie temporelle.

Usage : python backtest_frontiere_production.py
"""

import pandas as pd

from fetch_long_history import load_long_daily
from backtest_rsi_inverse import rsi_frame
from backtest_rsi_production import collect_signals, stats

START = "2020-08-11"
RSI_PERIOD = 21


def annees_positives(sig):
    """(années positives, années totales) — le juge le plus sévère."""
    if sig.empty:
        return 0, 0
    rows = []
    for y in sorted(sig["date"].dt.year.unique()):
        a = sig[sig["date"].dt.year == y]["gain_pct"]
        if len(a) >= 10:
            rows.append(a.mean() > 0)
    return sum(rows), len(rows)


def filtre_binaire(btc, index):
    ma = btc.rolling(200).mean()
    return (btc > ma).reindex(index).fillna(False)


def filtre_gradue(btc, index, seuils):
    """
    Retourne, pour chaque date, la FRACTION d'exposition autorisée selon la
    distance de BTC à sa moyenne 200 jours. `seuils` est une liste de couples
    (écart minimal en %, fraction). Sous le premier seuil : exposition nulle.
    """
    ma = btc.rolling(200).mean()
    ecart = ((btc / ma) - 1) * 100
    ecart = ecart.reindex(index)

    def fraction(v):
        if pd.isna(v):
            return 0.0
        best = 0.0
        for mini, frac in seuils:
            if v >= mini:
                best = frac
        return best

    return ecart.map(fraction)


def signaux_filtres(prices, rank, n_hold, hold, mask_series):
    """Applique un masque booléen jour par jour aux signaux collectés."""
    sig = collect_signals(prices, rank, n_hold, hold)
    if sig.empty:
        return sig
    m = mask_series.to_dict()
    return sig[sig["date"].map(lambda d: bool(m.get(d, False)))]


print("Chargement...", flush=True)
full = load_long_daily(verbose=False)
prices = full.loc[START:]
n_days = len(prices)

propre = [c for c in full.columns
          if full[c].first_valid_index() is not None and full[c].first_valid_index().year <= 2019]

btc = full["BTC/USDT"]
mask = filtre_binaire(btc, prices.index)

UNIVERS = {
    "production (40 paires)": prices,
    "propre (18 paires pré-2020)": prices[propre],
}

print(f"Période : {prices.index[0].date()} -> {prices.index[-1].date()}")
print(f"Filtre BTC > MM200 ouvert {100 * mask.mean():.0f} % du temps\n")

# ==========================================================================
# 1. La frontière quantité / qualité, univers de production
# ==========================================================================
for nom, univ in UNIVERS.items():
    rank = rsi_frame(univ, RSI_PERIOD)
    print(f"=== FRONTIÈRE — univers {nom} ===")
    print(f"{'top':>5} {'détention':>10} | {'signaux/sem':>12} | {'réussite':>9} | "
          f"{'espérance':>11} | {'gagnant':>9} | {'perdant':>9} | {'années +':>9}")
    for n_hold in (5, 8, 10, 12, 15, 20, 25):
        if n_hold > univ.shape[1]:
            continue
        for hold in (5, 7, 10, 14):
            sig = signaux_filtres(univ, rank, n_hold, hold, mask)
            s = stats(sig, n_days)
            if not s or s["n"] < 50:
                continue
            pos, tot = annees_positives(sig)
            print(f"{n_hold:>5} {hold:>9}j | {s['par_semaine']:>11.1f}  | {s['reussite']:>8.1f}% | "
                  f"{s['esperance']:>+10.2f}% | {s['gagnant_moyen']:>+8.2f}% | "
                  f"{s['perdant_moyen']:>+8.2f}% | {pos:>4}/{tot:<4}")
    print()

# ==========================================================================
# 2. Exposition graduée contre filtre binaire
# ==========================================================================
print("=== EXPOSITION GRADUÉE CONTRE FILTRE BINAIRE ===")
print("Le binaire coupe tout d'un coup. Moduler selon la distance à la moyenne")
print("est plus doux — encore faut-il que ça rapporte quelque chose.\n")

univ = prices[propre]
rank = rsi_frame(univ, RSI_PERIOD)
N_BASE, HOLD = 10, 7

GRADUATIONS = {
    "binaire (référence)": [(0, 1.0)],
    "doux : 0 % / +5 % / +15 %": [(0, 0.4), (5, 0.7), (15, 1.0)],
    "prudent : +2 % / +10 %": [(2, 0.6), (10, 1.0)],
    "agressif dès le franchissement": [(-3, 0.5), (0, 1.0)],
}
print(f"{'graduation':>32} | {'signaux/sem':>12} | {'réussite':>9} | {'espérance':>11} | {'années +':>9}")
for nom_g, seuils in GRADUATIONS.items():
    frac = filtre_gradue(btc, prices.index, seuils)
    # L'exposition graduée se traduit par un nombre de positions variable :
    # on collecte au maximum puis on ne garde, chaque jour, que les mieux
    # classés dans la limite autorisée. Approximation raisonnable puisque le
    # classement est déjà décroissant dans collect_signals.
    sig = collect_signals(univ, rank, N_BASE, HOLD)
    if sig.empty:
        continue
    fmap = frac.to_dict()
    garde = []
    compteur = {}
    for _, row in sig.iterrows():
        d = row["date"]
        f = fmap.get(d, 0.0)
        autorise = int(round(N_BASE * f))
        if autorise <= 0:
            continue
        compteur[d] = compteur.get(d, 0) + 1
        if compteur[d] <= autorise:
            garde.append(row)
    sig_g = pd.DataFrame(garde)
    s = stats(sig_g, n_days)
    if not s:
        continue
    pos, tot = annees_positives(sig_g)
    print(f"{nom_g:>32} | {s['par_semaine']:>11.1f}  | {s['reussite']:>8.1f}% | "
          f"{s['esperance']:>+10.2f}% | {pos:>4}/{tot:<4}")

# ==========================================================================
# 3. Combien de temps dure une fermeture du filtre ?
# ==========================================================================
print("\n=== DURÉE DES PÉRIODES SANS SIGNAL ===")
print("C'est le chiffre commercial décisif : un abonné doit savoir combien de")
print("temps le silence peut durer AVANT de payer, pas après.\n")
fermetures = []
debut = None
for d, ouvert in mask.items():
    if not ouvert and debut is None:
        debut = d
    elif ouvert and debut is not None:
        fermetures.append((debut, d, (d - debut).days))
        debut = None
if debut is not None:
    fermetures.append((debut, mask.index[-1], (mask.index[-1] - debut).days))

fermetures = [f for f in fermetures if f[2] >= 7]
for a, b, n in sorted(fermetures, key=lambda x: -x[2]):
    print(f"  {a.date()} -> {b.date()} : {n:>4} jours ({n/30:.1f} mois)")
if fermetures:
    durees = [f[2] for f in fermetures]
    print(f"\n  {len(fermetures)} fermetures d'au moins une semaine")
    print(f"  Médiane {sorted(durees)[len(durees)//2]} jours | la plus longue {max(durees)} jours "
          f"({max(durees)/30:.1f} mois)")
    print(f"  Total hors marché : {sum(durees)} jours sur {n_days} ({100*sum(durees)/n_days:.0f} %)")
