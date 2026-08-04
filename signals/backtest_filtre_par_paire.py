"""
Le filtre de tendance doit-il être global, ou propre à chaque paire ?

Le choix actuel, et pourquoi il mérite d'être remis en cause. Les trois familles
directionnelles (force relative, cassure de canal, expansion de volatilité) sont
coupées dès que le BITCOIN passe sous sa moyenne 200 jours. C'est ce filtre qui
fait passer la stratégie de 4 à 7 années positives, et c'est mesuré. Mais il est
GLOBAL : il éteint tout l'univers d'un coup, y compris les paires qui, elles,
sont franchement haussières.

Or c'est 43 % du temps. Sur cette période le canal ne produit que du carry, à
0,49 signal par jour, alors que l'objectif est un débit régulier autour de 3.

L'alternative testée ici : appliquer le momentum ABSOLU paire par paire plutôt
qu'au marché. Une paire n'est éligible que si ELLE est au-dessus de sa propre
moyenne 200 jours. En marché haussier presque toutes le sont, donc le
comportement change peu ; en marché baissier seules les rares vraiment fortes
restent, ce qui est exactement le tri qu'on veut.

C'est la même brique conceptuelle qu'Antonacci — momentum absolu — simplement
appliquée à l'actif au lieu de l'indice. Ce n'est pas un paramètre bricolé pour
faire monter la courbe.

Quatre variantes sont comparées, à familles identiques :

  1. AUCUN filtre — la référence sans garde-fou
  2. GLOBAL (BTC > MM200) — ce qui tourne aujourd'hui
  3. PAR PAIRE (chaque paire > sa MM200)
  4. LES DEUX — le plus strict

La question n'est pas seulement « laquelle rapporte le plus », mais « laquelle
produit encore quelque chose de RENTABLE quand le marché baisse ». Une variante
qui rapporte davantage en n'étant jamais active en marché baissier ne résout
pas le problème posé.

Usage : python backtest_filtre_par_paire.py
"""

import json
import os

import pandas as pd

from backtest_familles import (charger_ohlcv, atr, famille_cassure_haut,
                               famille_expansion_volatilite, START, FEE_ROUND_TRIP_PCT)
from backtest_rsi_inverse import rsi_frame
from backtest_rsi_production import collect_signals

HOLD = 7
SL_MULT = 4.0


def evaluer_avec_filtres(ohlcv, detecteur, filtre_global=None, par_paire=False,
                         hold=HOLD, sl_mult=SL_MULT, delay=1):
    """
    Applique un détecteur en combinant les deux filtres possibles.

    `filtre_global` est une série booléenne indexée par date (le régime du
    marché). `par_paire` active la condition « la paire est au-dessus de sa
    propre moyenne 200 jours », évaluée sur la clôture du jour du signal.
    """
    trades = []
    for pair, df in ohlcv.items():
        df = df.loc[START:]
        if len(df) < 220:
            continue
        a = atr(df)
        mm200_paire = df["close"].rolling(200).mean()
        au_dessus = (df["close"] > mm200_paire).fillna(False)
        declencheurs = detecteur(df).fillna(False)

        derniere_sortie = -1
        for i in range(60, len(df) - hold - delay):
            if not declencheurs.iloc[i] or i < derniere_sortie:
                continue
            date = df.index[i]
            if filtre_global is not None and not bool(filtre_global.get(date, False)):
                continue
            if par_paire and not bool(au_dessus.iloc[i]):
                continue

            entree = df["close"].iloc[i + delay]
            valeur_atr = a.iloc[i]
            if pd.isna(entree) or entree <= 0 or pd.isna(valeur_atr) or valeur_atr <= 0:
                continue
            derniere_sortie = i + delay + hold

            stop = entree - sl_mult * valeur_atr
            bougies = df.iloc[i + delay + 1: i + delay + 1 + hold]
            sortie = None
            for _, b in bougies.iterrows():
                if b["low"] <= stop:
                    sortie = stop
                    break
            if sortie is None:
                reste = bougies["close"].dropna()
                if reste.empty:
                    continue
                sortie = reste.iloc[-1]

            trades.append({"pair": pair, "date": date,
                           "gain_pct": (sortie - entree) / entree * 100 - FEE_ROUND_TRIP_PCT})
    return pd.DataFrame(trades)


def annees(t):
    lignes = [(y, t[t["date"].dt.year == y]["gain_pct"]) for y in sorted(t["date"].dt.year.unique())]
    lignes = [(y, s) for y, s in lignes if len(s) >= 10]
    return sum(1 for _, s in lignes if s.mean() > 0), len(lignes)


def rapport(t, label, n_jours, regime, jours_baisse):
    if t.empty or len(t) < 40:
        print(f"  {label:<26} : trop peu de signaux")
        return None
    pos, tot = annees(t)
    b = t[~t["date"].map(lambda d: regime.get(d, False))]
    part_baisse = (f"{len(b)/jours_baisse:>5.2f}/j  {b['gain_pct'].mean():>+7.2f} %  "
                   f"{100*(b['gain_pct']>0).mean():>5.1f} %" if len(b) >= 30 else "        aucun signal")
    print(f"  {label:<26} | {len(t)/n_jours:>6.2f} | {t['gain_pct'].mean():>+7.2f} % | "
          f"{100*(t['gain_pct']>0).mean():>6.1f} % | {pos}/{tot} | {part_baisse}")
    return t


print("Chargement...", flush=True)
ohlcv = charger_ohlcv()
prix = pd.DataFrame({p: d["close"] for p, d in ohlcv.items()}).sort_index()
btc = prix["BTC/USDT"]
mm200_marche = (btc > btc.rolling(200).mean())
prix = prix.loc[START:]
n_jours = len(prix)
ouvert = mm200_marche.reindex(prix.index).fillna(False).astype(bool)
regime = ouvert.to_dict()
jours_baisse = int((~ouvert).sum())

print(f"{prix.shape[1]} paires, {n_jours} jours | marché favorable {100*ouvert.mean():.0f} % du temps\n")

# Combien de paires sont au-dessus de LEUR moyenne quand le marché est sous la sienne ?
au_dessus_par_paire = pd.DataFrame({
    p: (d["close"] > d["close"].rolling(200).mean()) for p, d in ohlcv.items()
}).reindex(prix.index).fillna(False)
compte = au_dessus_par_paire.sum(axis=1)
print("=== COMBIEN DE PAIRES RESTENT HAUSSIÈRES QUAND LE MARCHÉ NE L'EST PAS ? ===")
print(f"  Marché favorable   : {compte[ouvert].mean():.1f} paires au-dessus de leur MM200 en moyenne")
print(f"  Marché défavorable : {compte[~ouvert].mean():.1f} paires — c'est le vivier disponible")
print(f"  Jours défavorables avec au moins 3 paires haussières : "
      f"{100*(compte[~ouvert] >= 3).mean():.0f} %\n")

FAMILLES = {
    "cassure de canal 50 j": famille_cassure_haut,
    "expansion de volatilité": famille_expansion_volatilite,
}

print("=== LES QUATRE VARIANTES DE FILTRE ===")
print("La colonne de droite est celle qui décide : que produit-on, et à quelle")
print("qualité, quand le marché est défavorable ?\n")
for nom_famille, detecteur in FAMILLES.items():
    print(f"--- {nom_famille} ---")
    print(f"  {'filtre':<26} | {'sig/j':>6} | {'moyenne':>9} | {'réussite':>7} | ann.+ | "
          f"{'EN MARCHÉ DÉFAVORABLE':>28}")
    rapport(evaluer_avec_filtres(ohlcv, detecteur), "1. aucun", n_jours, regime, jours_baisse)
    rapport(evaluer_avec_filtres(ohlcv, detecteur, filtre_global=regime),
            "2. global (BTC > MM200)", n_jours, regime, jours_baisse)
    rapport(evaluer_avec_filtres(ohlcv, detecteur, par_paire=True),
            "3. par paire", n_jours, regime, jours_baisse)
    rapport(evaluer_avec_filtres(ohlcv, detecteur, filtre_global=regime, par_paire=True),
            "4. les deux", n_jours, regime, jours_baisse)
    print()

# --- La force relative, dont le classement est transversal ---
print("--- force relative (top 12, 7 j) ---")
print(f"  {'filtre':<26} | {'sig/j':>6} | {'moyenne':>9} | {'réussite':>7} | ann.+ | "
      f"{'EN MARCHÉ DÉFAVORABLE':>28}")
rs_brut = collect_signals(prix, rsi_frame(prix, 21), 12, 7)
rapport(rs_brut, "1. aucun", n_jours, regime, jours_baisse)
rapport(rs_brut[rs_brut["date"].map(lambda d: regime.get(d, False))],
        "2. global (BTC > MM200)", n_jours, regime, jours_baisse)

# Filtre par paire appliqué au classement : la paire doit être au-dessus de sa
# propre moyenne le jour du signal.
def au_dessus_le_jour(row):
    col = au_dessus_par_paire.get(row["pair"])
    if col is None or row["date"] not in col.index:
        return False
    return bool(col.loc[row["date"]])

rs_paire = rs_brut[rs_brut.apply(au_dessus_le_jour, axis=1)]
rapport(rs_paire, "3. par paire", n_jours, regime, jours_baisse)
rapport(rs_paire[rs_paire["date"].map(lambda d: regime.get(d, False))],
        "4. les deux", n_jours, regime, jours_baisse)
