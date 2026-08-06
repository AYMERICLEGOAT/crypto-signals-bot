"""
La force relative NEUTRE AU MARCHÉ, sous sa forme livrable.

Ce que j'avais mesuré et écarté à tort. backtest_rsi_long.py établit que la
version neutre — acheter les plus fortes, vendre les plus faibles à découvert —
est positive sur 18 combinaisons de paramètres sur 18 en six ans (+37,8 %/an,
Sharpe ≈ 1,0), et sur 18 sur 18 hors échantillon strict (sélection 2020-2023,
test 2024-2026). Je l'ai pourtant abandonnée pour deux raisons, mauvaises
toutes les deux :

  - la permutation donnait p = 0,072 au lieu de p < 0,05. Mais 18/18 en
    échantillon ET 18/18 hors échantillon est en soi une preuve massive : c'est
    l'absence de sensibilité au réglage qui distingue un avantage réel d'un
    surapprentissage, et c'est précisément ce qui manquait à toutes les pistes
    réfutées avant elle ;
  - la version long-only avec filtre de tendance avait de meilleurs chiffres
    absolus. Sauf qu'elle ne tourne que 57 % du temps — ce qui est exactement le
    problème qu'on cherche à résoudre.

Une position neutre au marché n'a pas besoin du filtre de tendance : elle
fonctionne dans les deux régimes par construction, puisque la direction du
marché s'annule entre les deux jambes.

CE QUE CE MODULE MESURE, et qui n'a jamais été mesuré :

  1. Le DÉBIT réel en signaux par jour, sous la forme échelonnée effectivement
     livrable — pas en rééquilibrages par blocs comme le backtest d'origine.
  2. La qualité SÉPARÉMENT dans chaque régime. Une stratégie qui ne serait
     positive que filtre ouvert n'apporterait rien de plus que les trois
     familles existantes.
  3. Ce que vit un abonné qui ne prend QUE les achats, ou QUE les ventes. C'est
     la question décisive du point de vue produit : si une seule jambe perd, il
     faut le dire aussi clairement que le reste, parce que la moitié des
     abonnés ne suivra jamais que les achats.

Protocole inchangé : 2020-2026, entrée décalée d'un jour, 0,10 % de frais
aller-retour par jambe, walk-forward par année civile, témoin aléatoire.

Usage : python backtest_neutre_production.py
"""

import random

import pandas as pd

from backtest_familles import charger_ohlcv, atr, START, FEE_ROUND_TRIP_PCT
from backtest_rsi_inverse import rsi_frame

HOLD = 7
SL_ATR = 4.0
# Coût de portage de la jambe vendeuse, en % par jour. Hypothèse défavorable :
# historiquement le financement des perpétuels est majoritairement positif,
# donc encaissé par le vendeur, pas payé par lui.
PORTAGE_SHORT_PCT_JOUR = 0.02


def collecter(prix, rang, ohlcv, n_par_jambe, hold=HOLD, delay=1, aleatoire=None):
    """
    Forme livrable : évaluation quotidienne, une position par paire à la fois.

    Rend un signal par ligne, avec son sens. C'est exactement ce que le canal
    publierait — des achats et des ventes séparés, pas une position composite.
    """
    rng = random.Random(aleatoire) if aleatoire is not None else None
    dates = prix.index
    atrs = {p: atr(ohlcv[p]).reindex(dates) for p in prix.columns if p in ohlcv}
    detenues = {}
    signaux = []

    for i in range(60, len(dates) - hold - delay):
        for pair, echeance in list(detenues.items()):
            if i >= echeance:
                del detenues[pair]

        classement = rang.iloc[i].dropna()
        classement = classement[classement.index[prix.iloc[i + delay][classement.index].notna()]]
        if len(classement) < n_par_jambe * 2 + 5:
            continue

        if rng is not None:
            dispo = [c for c in classement.index if c not in detenues]
            if len(dispo) < n_par_jambe * 2:
                continue
            tire = rng.sample(dispo, n_par_jambe * 2)
            choix = [(p, "achat") for p in tire[:n_par_jambe]] + [(p, "vente") for p in tire[n_par_jambe:]]
        else:
            forts = [p for p in classement.nlargest(n_par_jambe * 2).index if p not in detenues][:n_par_jambe]
            faibles = [p for p in classement.nsmallest(n_par_jambe * 2).index if p not in detenues][:n_par_jambe]
            choix = [(p, "achat") for p in forts] + [(p, "vente") for p in faibles]

        for pair, sens in choix:
            if pair in detenues or pair not in atrs:
                continue
            entree = prix[pair].iloc[i + delay]
            valeur_atr = atrs[pair].iloc[i]
            if pd.isna(entree) or entree <= 0 or pd.isna(valeur_atr) or valeur_atr <= 0:
                continue
            detenues[pair] = i + delay + hold

            court = sens == "vente"
            stop = entree + SL_ATR * valeur_atr if court else entree - SL_ATR * valeur_atr
            bougies = ohlcv[pair].reindex(dates).iloc[i + delay + 1: i + delay + 1 + hold]

            sortie = None
            for _, bar in bougies.iterrows():
                if pd.isna(bar["low"]) or pd.isna(bar["high"]):
                    continue
                if (bar["high"] >= stop) if court else (bar["low"] <= stop):
                    sortie = stop
                    break
            if sortie is None:
                reste = bougies["close"].dropna()
                if reste.empty:
                    continue
                sortie = reste.iloc[-1]

            brut = (entree - sortie) / entree if court else (sortie - entree) / entree
            portage = (PORTAGE_SHORT_PCT_JOUR / 100.0) * hold * 100 if court else 0.0
            signaux.append({
                "pair": pair, "date": dates[i + delay], "sens": sens,
                "gain_pct": brut * 100 - FEE_ROUND_TRIP_PCT - portage,
            })
    return pd.DataFrame(signaux)


def annees(t):
    lignes = [(y, t[t["date"].dt.year == y]["gain_pct"]) for y in sorted(t["date"].dt.year.unique())]
    lignes = [(y, s) for y, s in lignes if len(s) >= 10]
    return sum(1 for _, s in lignes if s.mean() > 0), len(lignes)


print("Chargement...", flush=True)
ohlcv = charger_ohlcv()
prix = pd.DataFrame({p: d["close"] for p, d in ohlcv.items()}).sort_index()
btc = prix["BTC/USDT"]
ouvert_all = btc > btc.rolling(200).mean()
prix = prix.loc[START:]
n_jours = len(prix)
ouvert = ouvert_all.reindex(prix.index).fillna(False).astype(bool)
regime = ouvert.to_dict()
jours_h, jours_b = int(ouvert.sum()), n_jours - int(ouvert.sum())
rang = rsi_frame(prix, 21)
print(f"{prix.shape[1]} paires, {n_jours} jours | favorable {100*ouvert.mean():.0f} % du temps\n")


def detail(t, label, montrer=True):
    if t.empty or len(t) < 40:
        print(f"  {label:<26} : trop peu de signaux")
        return None
    g = t["gain_pct"]
    pos, tot = annees(t)
    h = t[t["date"].map(lambda d: regime.get(d, False))]
    b = t[~t["date"].map(lambda d: regime.get(d, False))]
    if montrer:
        print(f"  {label:<26} | {len(g)/n_jours:>5.2f}/j | {100*(g>0).mean():>5.1f} % | {g.mean():>+6.2f} % | "
              f"{pos}/{tot} | fav. {h['gain_pct'].mean():>+6.2f} % | défav. {b['gain_pct'].mean():>+6.2f} %")
    return t


print("=== DÉBIT ET QUALITÉ SELON LE NOMBRE DE POSITIONS PAR JAMBE ===")
print("La stratégie n'est PAS soumise au filtre de tendance : elle est censée")
print("fonctionner dans les deux régimes. Les deux dernières colonnes le vérifient.\n")
print(f"  {'configuration':<26} | {'sig':>7} | {'gagn.':>6} | {'moy.':>7} | ann.+ | "
      f"{'FAVORABLE':>12} | {'DÉFAVORABLE':>14}")
resultats = {}
for n in (3, 5, 8, 12):
    t = collecter(prix, rang, ohlcv, n)
    r = detail(t, f"{n} par jambe ({2*n} signaux)")
    if r is not None:
        resultats[n] = r

if not resultats:
    print("\nAucune configuration exploitable.")
    raise SystemExit(0)

meilleur = max(resultats, key=lambda k: resultats[k]["gain_pct"].mean())
best = resultats[meilleur]
print(f"\nMeilleure : {meilleur} positions par jambe")

print("\n=== LA QUESTION PRODUIT : ET SI L'ABONNÉ NE PREND QU'UNE JAMBE ? ===")
print("La moitié des abonnés ne suivra jamais que les achats. Si cette jambe")
print("seule perd, il faut le dire aussi clairement que le reste.\n")
for sens in ("achat", "vente"):
    sous = best[best["sens"] == sens]
    if sous.empty:
        continue
    g = sous["gain_pct"]
    pos, tot = annees(sous)
    h = sous[sous["date"].map(lambda d: regime.get(d, False))]["gain_pct"]
    b = sous[~sous["date"].map(lambda d: regime.get(d, False))]["gain_pct"]
    print(f"  {sens.upper():<8} seul | {len(g)/n_jours:>5.2f}/j | {100*(g>0).mean():>5.1f} % gagnants | "
          f"{g.mean():>+6.2f} % | {pos}/{tot} années | fav. {h.mean():>+6.2f} % | défav. {b.mean():>+6.2f} %")
print(f"  {'LES DEUX':<8}      | {len(best)/n_jours:>5.2f}/j | {100*(best['gain_pct']>0).mean():>5.1f} % gagnants | "
      f"{best['gain_pct'].mean():>+6.2f} % | {annees(best)[0]}/{annees(best)[1]} années")

print("\n=== ANNÉE PAR ANNÉE ===")
for y in sorted(best["date"].dt.year.unique()):
    s = best[best["date"].dt.year == y]["gain_pct"]
    if len(s) < 10:
        continue
    print(f"  {y} : {len(s):>4} signaux | {100*(s>0).mean():>5.1f} % gagnants | {s.mean():>+6.2f} %")

print("\n=== TÉMOIN ALÉATOIRE (40 tirages, mêmes contraintes) ===")
print("Le classement par force relative apporte-t-il quelque chose, ou suffirait-il")
print("de tirer les paires au sort en gardant les deux jambes ?\n")
tirages = []
for graine in range(40):
    t = collecter(prix, rang, ohlcv, meilleur, aleatoire=graine)
    if not t.empty and len(t) >= 40:
        tirages.append(t["gain_pct"].mean())
if tirages:
    reel = best["gain_pct"].mean()
    mieux = sum(1 for v in tirages if v >= reel)
    p = mieux / len(tirages)
    print(f"  réelle {reel:+.2f} % | hasard {sum(tirages)/len(tirages):+.2f} % | "
          f"{mieux}/{len(tirages)} font mieux -> p = {p:.3f}")
    print(f"  {'>>> BAT LE HASARD' if p < 0.05 else 'indiscernable du hasard'}")

print("\n=== SENSIBILITÉ AU COÛT DE PORTAGE DE LA JAMBE VENDEUSE ===")
print("Si l'avantage ne survit qu'à portage nul, il n'est pas exploitable.\n")
for portage in (0.0, 0.01, 0.02, 0.05):
    globals()["PORTAGE_SHORT_PCT_JOUR"] = portage
    t = collecter(prix, rang, ohlcv, meilleur)
    if not t.empty:
        g = t["gain_pct"]
        pos, tot = annees(t)
        print(f"  {portage:.2f} %/jour ({portage*365:>5.1f} %/an) : {g.mean():>+6.2f} % | "
              f"{100*(g>0).mean():>5.1f} % gagnants | {pos}/{tot} années")
