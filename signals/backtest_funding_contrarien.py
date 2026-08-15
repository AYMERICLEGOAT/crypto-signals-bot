"""
Le financement extrême est-il un signal DIRECTIONNEL exploitable ?

L'IDÉE, ET POURQUOI ELLE N'A JAMAIS ÉTÉ TESTÉE ICI.

Ce projet utilise déjà le financement, mais d'une seule façon : le CARRY, qui
l'encaisse en restant neutre au marché. Personne n'a testé le financement comme
signal de DIRECTION.

Le raisonnement est un raisonnement de positionnement, pas de prix. Quand le
financement d'un perpétuel devient nettement négatif, ce sont les VENDEURS qui
paient les acheteurs : la foule est short, et elle paie pour le rester. Un
positionnement encombré d'un côté rend le mouvement inverse plus violent, parce
que chaque hausse force des rachats qui alimentent la hausse. C'est le squeeze.

Trois raisons de le tester MAINTENANT plutôt qu'une autre piste :

  1. C'est ORTHOGONAL à tout ce qui existe ici. Les cinq moteurs du projet
     lisent le PRIX (croisements, classements de force, cassures, expansion de
     volatilité). Celui-ci lit le POSITIONNEMENT. Deux sources d'information
     différentes ont une chance d'être décorrélées ; deux variantes de momentum
     n'en ont aucune.
  2. Il travaille précisément dans le trou. Les squeezes de shorts arrivent en
     marché baissier — c'est-à-dire pendant les 42 % du temps où le filtre de
     tendance coupe les trois moteurs directionnels.
  3. Il est EXÉCUTABLE. Un achat spot avec un stop, une seule jambe. C'est ce
     qui manque au carry et au momentum transversal neutre, tous deux mesurés
     positifs mais injouables pour un particulier.

CE QUE DIT LA LITTÉRATURE, ET CE QU'ELLE VAUT. Le consensus des praticiens est
convergent — « un financement profondément négatif a précédé chaque rebond
majeur » — mais il est ANECDOTIQUE : on cite novembre 2022 et mars 2020, jamais
la distribution complète. C'est exactement la forme d'affirmation que le témoin
aléatoire de ce projet a déjà réfutée six fois. Rien n'est retenu sans lui.

PROTOCOLE, identique à backtest_momentum4h_temoin.py :
  - régime défavorable uniquement (Bitcoin sous sa moyenne 200 jours) ;
  - frais aller-retour comptés ;
  - entrées non chevauchantes, pour que les rendements restent indépendants ;
  - témoin aléatoire à mêmes dates, même nombre de positions, même durée ;
  - balayage de la région de paramètres, jamais un point isolé ;
  - retrait du meilleur trade, qui a suffi à faire tomber le momentum top 2.

Usage : python backtest_funding_contrarien.py
"""

from __future__ import annotations

import io
import json
import os
import random

import pandas as pd

import config

CACHE_PRIX = os.path.join(os.path.dirname(__file__), "data", "tf_cache")
CACHE_FUNDING = os.path.join(os.path.dirname(__file__), "data", "funding")

MA_JOURS = config.RS_TREND_MA_PERIOD  # 200
FRAIS_ALLER_RETOUR_PCT = 0.20
N_PERMUTATIONS = 300


def charger_prix_journaliers() -> pd.DataFrame:
    """Clôtures journalières des paires de l'univers tradable."""
    series = {}
    for pair in config.PAIRS:
        symbole = pair.replace("/", "")
        chemin = os.path.join(CACHE_PRIX, f"{symbole}_1d_730d.json")
        if not os.path.exists(chemin):
            continue
        bougies = json.load(io.open(chemin, encoding="utf-8"))
        df = pd.DataFrame(bougies, columns=["ts_ms", "open", "high", "low", "close", "volume"])
        df["date"] = pd.to_datetime(df["ts_ms"], unit="ms").dt.normalize()
        series[pair] = df.set_index("date")["close"].astype(float)
    return pd.DataFrame(series).sort_index()


def charger_funding_journalier(paires: list[str], index: pd.DatetimeIndex) -> pd.DataFrame:
    """
    Financement moyen par JOUR, aligné sur l'index des prix.

    Le financement est versé toutes les 8 heures ; on en prend la somme
    quotidienne, qui est la grandeur économiquement lisible : « ce que coûte ou
    rapporte la journée de position ».
    """
    series = {}
    for pair in paires:
        symbole = pair.replace("/", "")
        chemin = os.path.join(CACHE_FUNDING, f"{symbole}.json")
        if not os.path.exists(chemin):
            continue
        lignes = json.load(io.open(chemin, encoding="utf-8"))
        if not lignes:
            continue
        df = pd.DataFrame(lignes)
        df["date"] = pd.to_datetime(df["fundingTime"], unit="ms").dt.normalize()
        df["taux"] = df["fundingRate"].astype(float) * 100  # en pourcentage
        quotidien = df.groupby("date")["taux"].sum()
        series[pair] = quotidien.reindex(index)
    return pd.DataFrame(series)


def regime_defavorable(prix: pd.DataFrame) -> pd.Series:
    btc = prix["BTC/USDT"]
    return btc < btc.rolling(MA_JOURS).mean()


def simuler(prix, score, defavorable, top_n, hold, sens="negatif"):
    """
    `sens = "negatif"` : acheter les financements les plus NÉGATIFS (shorts
    encombrés, thèse du squeeze). `sens = "positif"` : l'inverse, qui sert de
    falsification — si les deux gagnent, ce n'est pas le financement qui parle.
    """
    rendements = []
    index = prix.index
    debut = MA_JOURS + 5
    for i in range(debut, len(index) - hold, hold):
        if not bool(defavorable.iloc[i]):
            continue
        ligne = score.iloc[i].dropna()
        # On exige un minimum de paires notées, sinon le « classement » porte
        # sur trois noms et ne veut rien dire.
        if len(ligne) < 12:
            continue
        ordonne = ligne.sort_values(ascending=(sens == "negatif"))
        entree, sortie = prix.iloc[i], prix.iloc[i + hold]
        for paire in ordonne.index[:top_n]:
            if pd.isna(entree.get(paire)) or pd.isna(sortie.get(paire)):
                continue
            brut = (sortie[paire] - entree[paire]) / entree[paire] * 100
            rendements.append(brut - FRAIS_ALLER_RETOUR_PCT)
    return rendements


def simuler_aleatoire(prix, score, defavorable, top_n, hold, graine):
    rng = random.Random(graine)
    rendements = []
    index = prix.index
    debut = MA_JOURS + 5
    for i in range(debut, len(index) - hold, hold):
        if not bool(defavorable.iloc[i]):
            continue
        ligne = score.iloc[i].dropna()
        if len(ligne) < 12:
            continue
        entree, sortie = prix.iloc[i], prix.iloc[i + hold]
        eligibles = [p for p in ligne.index if not pd.isna(entree.get(p)) and not pd.isna(sortie.get(p))]
        if len(eligibles) < top_n:
            continue
        for paire in rng.sample(eligibles, top_n):
            brut = (sortie[paire] - entree[paire]) / entree[paire] * 100
            rendements.append(brut - FRAIS_ALLER_RETOUR_PCT)
    return rendements


def resume(nom, r):
    if not r:
        print(f"  {nom:<34} aucun trade")
        return 0.0
    s = pd.Series(r)
    print(f"  {nom:<34} {len(s):>4} trades | esperance {s.mean():+6.3f} % | "
          f"reussite {(s > 0).mean() * 100:5.1f} % | pire {s.min():+7.2f} % | meilleur {s.max():+7.2f} %")
    return s.mean()


def main() -> None:
    print("Chargement...", flush=True)
    prix = charger_prix_journaliers()
    if prix.empty or "BTC/USDT" not in prix.columns:
        print("Cache de prix insuffisant.")
        return
    funding = charger_funding_journalier(list(prix.columns), prix.index)
    couvertes = [c for c in funding.columns if funding[c].notna().sum() > 300]
    funding = funding[couvertes]
    prix = prix[[c for c in prix.columns if c in couvertes or c == "BTC/USDT"]]

    defav = regime_defavorable(prix)
    print(f"{len(couvertes)} paires avec financement exploitable | {prix.shape[0]} jours "
          f"({prix.index[0]:%Y-%m-%d} -> {prix.index[-1]:%Y-%m-%d})")
    print(f"Regime defavorable : {defav.iloc[MA_JOURS:].mean() * 100:.1f} % de la periode\n")

    # Le score : moyenne du financement sur les N derniers jours. Un seul jour
    # est trop bruyant, une semaine efface l'extreme qu'on cherche justement.
    for fenetre in (1, 3, 7):
        score = funding.rolling(fenetre).mean()
        print(f"--- Financement moyen sur {fenetre} jour(s) ---")
        for top_n in (1, 2, 3):
            for hold in (3, 5, 7):
                r = simuler(prix, score, defav, top_n, hold, "negatif")
                if len(r) >= 30:
                    resume(f"top {top_n} / {hold} j / plus NEGATIFS", r)
        print()


if __name__ == "__main__":
    main()
