"""
Les deux familles annoncées mais jamais implémentées : valent-elles d'exister ?

CE QUI A DÉCLENCHÉ CETTE MESURE. Le produit annonçait publiquement cinq familles
de signaux — force relative, cassure de canal, expansion de volatilité, carry,
momentum 4 heures — alors que trois seulement existaient dans le code. Les deux
manquantes avaient bien été validées dans backtest_familles.py, mais à
l'intérieur d'un portefeuille agrégé et sans le filtre de tendance de
production. Personne ne les avait mesurées SEULES, dans les conditions où elles
tourneraient réellement.

Les textes ont été corrigés pour ne plus les annoncer. Reste la question qui
compte : faut-il les écrire ?

CE QUI EST MESURÉ ICI, ET PAS AILLEURS.

  1. La géométrie de PRODUCTION, pas celle du test exploratoire : stop à
     4 x ATR, sortie temporelle à 7 jours, frais aller-retour déduits, entrée
     décalée d'un jour (aucune exécution instantanée supposée).
  2. Le FILTRE DE TENDANCE, qui commande les moteurs directionnels. Sans lui,
     une famille peut sembler rentable simplement parce qu'elle a acheté
     pendant les hausses de 2020-2021 — c'est le biais que ce filtre existe
     pour supprimer.
  3. Le TÉMOIN ALÉATOIRE, de même densité. C'est le seul juge qui compte :
     une famille qui ne bat pas un tirage au sort à contraintes égales
     n'apporte rien, quelle que soit son espérance affichée. Dix approches sur
     douze ont échoué exactement là.
  4. L'ANNÉE PAR ANNÉE. Une espérance moyenne positive portée par une seule
     année exceptionnelle n'est pas un avantage, c'est un souvenir.

LA BARRE, FIXÉE AVANT DE REGARDER LES RÉSULTATS. Une famille n'est retenue que
si elle réunit les quatre conditions suivantes :

    - au moins 60 signaux, sinon la moyenne ne veut rien dire ;
    - espérance nette positive avec le filtre de tendance actif ;
    - p < 0,05 contre le témoin aléatoire ;
    - au moins 4 années positives sur 6.

Écrire la barre d'abord évite l'exercice qui consiste à la déplacer une fois les
chiffres connus.

Usage : python backtest_deux_familles.py
"""

import numpy as np
import pandas as pd

import config
from backtest_familles import (
    charger_ohlcv,
    atr,
    evaluer,
    famille_cassure_haut,
    famille_expansion_volatilite,
    START,
    N_PERMUTATIONS,
)

MIN_SIGNAUX = 60
SEUIL_P = 0.05
MIN_ANNEES_POSITIVES = 4


def filtre_de_tendance(ohlcv):
    """
    Le Bitcoin est-il au-dessus de sa moyenne 200 jours ? Série booléenne
    indexée par date, exactement comme le moteur de production le calcule.
    """
    btc = ohlcv.get("BTC/USDT")
    if btc is None:
        return None
    closes = btc["close"]
    return (closes > closes.rolling(config.RS_TREND_MA_PERIOD).mean()).fillna(False)


def appliquer_filtre(detecteur, ouvert):
    """
    Enveloppe un détecteur pour qu'il ne se déclenche que les jours où le filtre
    de tendance est ouvert. C'est ce que fait le moteur en production, et le
    mesurer autrement donnerait un chiffre qu'aucun abonné ne verra jamais.
    """
    def _filtre(df):
        brut = detecteur(df).fillna(False)
        aligne = ouvert.reindex(df.index).fillna(False)
        return brut & aligne
    return _filtre


def annees_positives(trades):
    if trades.empty:
        return 0, 0
    par_an = trades.assign(an=pd.to_datetime(trades["date"]).dt.year).groupby("an")["gain_pct"].mean()
    return int((par_an > 0).sum()), len(par_an)


def mesurer(ohlcv, nom, detecteur, ouvert, n_jours):
    print(f"\n{'=' * 74}\n{nom}\n{'=' * 74}")

    brut = evaluer(ohlcv, detecteur, "achat")
    filtre = evaluer(ohlcv, appliquer_filtre(detecteur, ouvert), "achat")

    for libelle, t in (("sans filtre de tendance", brut), ("AVEC filtre de tendance", filtre)):
        if t.empty or len(t) < 10:
            print(f"  {libelle:<26} : {0 if t.empty else len(t)} signaux, trop peu pour conclure")
            continue
        g = t["gain_pct"]
        pos, tot = annees_positives(t)
        print(f"  {libelle:<26} | {len(g):>4} signaux | {len(g)/n_jours:>5.2f}/j | "
              f"{100*(g>0).mean():>5.1f} % gagnants | {g.mean():>+7.3f} % | {pos}/{tot} années +")

    if filtre.empty or len(filtre) < MIN_SIGNAUX:
        print(f"\n  VERDICT : REJETÉE — {0 if filtre.empty else len(filtre)} signaux avec filtre, "
              f"moins que les {MIN_SIGNAUX} requis. Une moyenne sur si peu ne veut rien dire.")
        return False

    # Témoin aléatoire : même densité, dates tirées au sort.
    print(f"\n  Témoin aléatoire ({N_PERMUTATIONS} tirages de même densité)...", flush=True)
    tirages = []
    for graine in range(N_PERMUTATIONS):
        t = evaluer(ohlcv, appliquer_filtre(detecteur, ouvert), "achat", aleatoire=graine)
        if not t.empty and len(t) >= 20:
            tirages.append(t["gain_pct"].mean())

    reel = filtre["gain_pct"].mean()
    pos, tot = annees_positives(filtre)

    if not tirages:
        print("  Témoin inexploitable : aucune conclusion possible.")
        return False

    tirages = np.array(tirages)
    p = float((tirages >= reel).mean())
    print(f"  réel {reel:+.3f} %  |  témoin {tirages.mean():+.3f} % "
          f"(min {tirages.min():+.3f}, max {tirages.max():+.3f})  |  p = {p:.3f}")

    conditions = [
        (len(filtre) >= MIN_SIGNAUX, f"{len(filtre)} signaux >= {MIN_SIGNAUX}"),
        (reel > 0, f"espérance {reel:+.3f} % > 0"),
        (p < SEUIL_P, f"p = {p:.3f} < {SEUIL_P}"),
        (pos >= MIN_ANNEES_POSITIVES, f"{pos}/{tot} années positives >= {MIN_ANNEES_POSITIVES}"),
    ]
    print()
    for ok, libelle in conditions:
        print(f"    {'OK   ' if ok else 'ÉCHEC'} {libelle}")

    retenue = all(ok for ok, _ in conditions)
    print(f"\n  VERDICT : {'RETENUE' if retenue else 'REJETÉE'}")
    return retenue


if __name__ == "__main__":
    ohlcv = charger_ohlcv()
    if len(ohlcv) < 20:
        print(f"Seulement {len(ohlcv)} paires en cache : lance d'abord fetch_long_history.py.")
        raise SystemExit(1)

    ouvert = filtre_de_tendance(ohlcv)
    if ouvert is None:
        print("Bitcoin absent du cache : le filtre de tendance ne peut pas être calculé.")
        raise SystemExit(1)

    ref = next(iter(ohlcv.values())).loc[START:]
    n_jours = len(ref)
    print(f"{len(ohlcv)} paires, {n_jours} jours depuis {START}")
    print(f"Filtre de tendance ouvert {100 * ouvert.loc[START:].mean():.0f} % du temps")
    print(f"\nBarre fixée AVANT de regarder : >= {MIN_SIGNAUX} signaux, espérance > 0, "
          f"p < {SEUIL_P}, >= {MIN_ANNEES_POSITIVES} années positives.")

    resultats = {
        "Cassure de canal (plus haut 50 jours)": mesurer(
            ohlcv, "FAMILLE A — CASSURE DE CANAL", famille_cassure_haut, ouvert, n_jours),
        "Expansion de volatilité": mesurer(
            ohlcv, "FAMILLE B — EXPANSION DE VOLATILITÉ", famille_expansion_volatilite, ouvert, n_jours),
    }

    print(f"\n{'=' * 74}\nCONCLUSION\n{'=' * 74}")
    for nom, retenue in resultats.items():
        print(f"  {nom:<44} {'À IMPLÉMENTER' if retenue else 'à ne pas implémenter'}")
