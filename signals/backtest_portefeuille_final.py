"""
Le système complet : quatre familles réunies, combien de signaux par jour ?

L'objectif fixé. Le canal vise 2 à 6 signaux par jour, tous les jours, avec une
qualité que les abonnés ressentent — donc un taux de réussite élevé, pas
seulement une espérance positive.

Ce qui a été établi famille par famille, chacune au même protocole (2020-2026,
entrée décalée d'un jour, frais réels, walk-forward annuel, témoin aléatoire) :

  FORCE RELATIVE — momentum transversal, achat des 12 plus fortes sur 40,
  tenues 7 jours. 8,0 signaux/semaine, 47,7 % de réussite, +3,22 %. Ne
  fonctionne QUE filtre ouvert.

  CASSURE DE CANAL — momentum temporel, achat sur cassure du plus haut 50
  jours. p = 0,000 contre le hasard. +5,93 % filtre ouvert, -1,23 % fermé.

  EXPANSION DE VOLATILITÉ — réveil de la volatilité après compression.
  p = 0,017. +5,58 % filtre ouvert, -2,65 % fermé.

  CARRY DE FINANCEMENT — détention du spot contre vente du perpétuel, neutre
  au marché. p = 0,000. Le SEUL à être positif dans les deux régimes : +1,55 %
  et 93,3 % de réussite filtre ouvert, +0,31 % et 75,5 % filtre fermé.

Ce module assemble le tout et répond à trois questions concrètes :

  1. Combien de signaux par jour, en marché favorable et en marché défavorable ?
  2. Quelle est la qualité de l'ensemble, une fois les familles mélangées ?
  3. Les familles sont-elles réellement décorrélées, ou tirent-elles toutes le
     même jour sur les mêmes paires — auquel cas le compte serait gonflé et la
     diversification illusoire ?

Les trois familles directionnelles sont soumises au filtre de tendance. Le
carry ne l'est pas : c'est tout son intérêt.

Usage : python backtest_portefeuille_final.py
"""

import json
import os

import pandas as pd

import config
import binance_client
from backtest_familles import (charger_ohlcv, evaluer, famille_cassure_haut,
                               famille_expansion_volatilite, atr)
from backtest_rsi_inverse import rsi_frame
from backtest_rsi_production import collect_signals
from backtest_carry_frontiere import construire_funding
from backtest_carry_production import simuler_echelonne

START = "2020-08-11"
CARRY_PLACES, CARRY_DUREE = 20, 21
RS_TOP, RS_HOLD = 12, 7


def famille_cassure_20(df):
    return famille_cassure_haut(df, fenetre=20)


def famille_cassure_100(df):
    return famille_cassure_haut(df, fenetre=100)


print("Chargement...", flush=True)
ohlcv = charger_ohlcv()
prix = pd.DataFrame({p: d["close"] for p, d in ohlcv.items()}).sort_index()
btc = prix["BTC/USDT"]
mm200 = (btc > btc.rolling(200).mean())
prix = prix.loc[START:]
n_jours = len(prix)
ouvert = mm200.reindex(prix.index).fillna(False).astype(bool)
regime = ouvert.to_dict()
print(f"{prix.shape[1]} paires, {n_jours} jours, filtre ouvert {100*ouvert.mean():.0f} % du temps\n")

# --------------------------------------------------------------------------
# Les cassures à plusieurs horizons sont-elles des signaux DIFFÉRENTS ?
# Un plus haut de 20 jours n'est pas un plus haut de 100 jours : si chaque
# horizon passe le témoin aléatoire séparément, ce sont autant de familles.
# --------------------------------------------------------------------------
print("=== LES CASSURES À PLUSIEURS HORIZONS ===")
print(f"  {'horizon':<24} | {'signaux/j':>10} | {'réussite':>9} | {'moyenne':>9} | {'années+':>8}")
horizons = {"cassure 20 jours": famille_cassure_20,
            "cassure 50 jours": famille_cassure_haut,
            "cassure 100 jours": famille_cassure_100}
cassures = {}
for nom, detecteur in horizons.items():
    t = evaluer(ohlcv, detecteur, "achat")
    if t.empty:
        continue
    t = t[t["date"].map(lambda d: regime.get(d, False))]  # filtre de tendance
    annees = [(y, t[t["date"].dt.year == y]["gain_pct"]) for y in sorted(t["date"].dt.year.unique())]
    annees = [(y, s) for y, s in annees if len(s) >= 10]
    pos = sum(1 for _, s in annees if s.mean() > 0)
    cassures[nom] = t
    print(f"  {nom:<24} | {len(t)/n_jours:>9.2f} | {100*(t['gain_pct']>0).mean():>8.1f} % | "
          f"{t['gain_pct'].mean():>+8.2f} % | {pos:>4}/{len(annees):<3}")

# --------------------------------------------------------------------------
# Assemblage
# --------------------------------------------------------------------------
print("\nAssemblage des familles...", flush=True)
composants = {}

rs = collect_signals(prix, rsi_frame(prix, 21), RS_TOP, RS_HOLD)
composants["force relative"] = rs[rs["date"].map(lambda d: regime.get(d, False))][["pair", "date", "gain_pct"]]

for nom, t in cassures.items():
    composants[nom] = t[["pair", "date", "gain_pct"]]

vol = evaluer(ohlcv, famille_expansion_volatilite, "achat")
composants["expansion de volatilité"] = vol[vol["date"].map(lambda d: regime.get(d, False))][["pair", "date", "gain_pct"]]

funding = construire_funding()
# Forme LIVRÉE : évaluation quotidienne et entrées échelonnées, avec les
# garde-fous de config.py (plancher qui couvre les frais, plafond contre les
# financements de manie). C'est exactement ce que carry_engine.py émet.
carry = simuler_echelonne(funding, CARRY_PLACES, CARRY_DUREE, plafond=0.15, plancher=0.015)
carry = carry.rename(columns={"net": "gain_pct"})[["pair", "date", "gain_pct"]]
composants["carry de financement"] = carry

print("\n=== CHAQUE FAMILLE DANS L'ENSEMBLE ===")
print(f"  {'famille':<24} | {'signaux':>8} | {'/jour':>7} | {'réussite':>9} | {'moyenne':>9}")
for nom, t in composants.items():
    if t.empty:
        continue
    print(f"  {nom:<24} | {len(t):>8} | {len(t)/n_jours:>6.2f} | "
          f"{100*(t['gain_pct']>0).mean():>8.1f} % | {t['gain_pct'].mean():>+8.2f} %")

tout = pd.concat([t.assign(famille=nom) for nom, t in composants.items()], ignore_index=True)

# Un même couple (paire, jour) touché par deux familles ne fait qu'UN signal
# envoyé à l'abonné : compter deux fois gonflerait artificiellement le total.
tout["cle"] = tout["pair"] + "|" + tout["date"].astype(str)
doublons = len(tout) - tout["cle"].nunique()
uniques = tout.drop_duplicates("cle")

print(f"\n  Total brut : {len(tout)} signaux")
print(f"  Doublons (même paire, même jour, deux familles) : {doublons} "
      f"({100*doublons/len(tout):.1f} %)")
print(f"  Signaux réellement envoyables : {len(uniques)}")

print("\n=== COMBIEN DE SIGNAUX PAR JOUR, SELON LE RÉGIME ===")
en_hausse = uniques["date"].map(lambda d: regime.get(d, False))
jours_hausse = int(ouvert.sum())
jours_baisse = n_jours - jours_hausse
n_h, n_b = int(en_hausse.sum()), int((~en_hausse).sum())

print(f"  Marché FAVORABLE ({jours_hausse} jours, {100*jours_hausse/n_jours:.0f} % du temps)")
print(f"    {n_h} signaux -> {n_h/jours_hausse:.2f} par jour")
print(f"    réussite {100*(uniques[en_hausse]['gain_pct']>0).mean():.1f} % | "
      f"moyenne {uniques[en_hausse]['gain_pct'].mean():+.2f} %")
print(f"  Marché DÉFAVORABLE ({jours_baisse} jours, {100*jours_baisse/n_jours:.0f} % du temps)")
print(f"    {n_b} signaux -> {n_b/jours_baisse:.2f} par jour")
print(f"    réussite {100*(uniques[~en_hausse]['gain_pct']>0).mean():.1f} % | "
      f"moyenne {uniques[~en_hausse]['gain_pct'].mean():+.2f} %")

couverture = uniques["date"].nunique()
print(f"\n  Jours avec au moins un signal : {couverture}/{n_jours} ({100*couverture/n_jours:.0f} %)")
par_jour = uniques.groupby("date").size()
print(f"  Répartition : médiane {par_jour.median():.0f}/jour | "
      f"{100*(par_jour >= 2).mean():.0f} % des jours actifs ont 2 signaux ou plus")

print("\n=== ANNÉE PAR ANNÉE, SYSTÈME COMPLET ===")
print(f"  {'année':>6} | {'signaux':>8} | {'/jour':>7} | {'réussite':>9} | {'moyenne':>9}")
for annee in sorted(uniques["date"].dt.year.unique()):
    s = uniques[uniques["date"].dt.year == annee]
    jours = len(prix[prix.index.year == annee])
    if len(s) < 20:
        continue
    print(f"  {annee:>6} | {len(s):>8} | {len(s)/jours:>6.2f} | "
          f"{100*(s['gain_pct']>0).mean():>8.1f} % | {s['gain_pct'].mean():>+8.2f} %")

print("\n=== LES FAMILLES SONT-ELLES VRAIMENT DÉCORRÉLÉES ? ===")
print("Si elles tirent les mêmes jours, la diversification est illusoire et le")
print("canal alternera entre des rafales et de longs silences.\n")
quotidien = tout.groupby(["famille", "date"]).size().unstack(fill_value=0).T
quotidien = quotidien.reindex(prix.index, fill_value=0)
correl = quotidien.corr()
familles = list(correl.columns)
print("  " + " " * 24 + "".join(f"{f[:11]:>13}" for f in familles))
for f in familles:
    print(f"  {f:<24}" + "".join(f"{correl.loc[f, g]:>13.2f}" for g in familles))
