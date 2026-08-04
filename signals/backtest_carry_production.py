"""
Le carry sous sa forme LIVRABLE : évaluation quotidienne, entrées échelonnées.

Pourquoi ce module en plus des précédents. Les mesures qui ont validé le carry
rééquilibraient par BLOCS : on ouvrait les 15 positions le même jour, on les
tenait 21 jours, on refermait tout, on recommençait. C'est correct
statistiquement mais inexploitable pour un canal — les abonnés recevraient
15 signaux d'un coup puis plus rien pendant trois semaines.

La forme livrable évalue le classement CHAQUE jour et ouvre une position dès
qu'une place se libère. Le nombre de positions simultanées est le même, la
durée de détention aussi, donc le débit théorique est identique : avec N places
et D jours de détention, on ouvre N/D position par jour, réparties au lieu
d'arriver en rafale.

Mais « théoriquement identique » ne suffit pas dans ce projet. Deux différences
réelles peuvent apparaître, et il faut les mesurer :

  - Les dates d'entrée changent. Une entrée échelonnée tombe sur des jours que
    le rééquilibrage par blocs n'a jamais échantillonnés, donc sur d'autres
    conditions de marché.
  - La sélection change. Au lieu de prendre les 15 meilleures d'un coup, on
    prend la meilleure encore disponible, une par une : le classement bouge
    entre deux ouvertures.

Ce module mesure donc la forme livrable exacte, et la compare au bloc.

Deux garde-fous supplémentaires, retenus des mesures précédentes :
  - un PLAFOND de financement à l'entrée. Un taux extrême ne signale pas une
    bonne affaire mais une manie, et c'est là que se logent les pertes rares et
    énormes : sans plafond, la pire position observée sur univers élargi
    atteignait -68 % ;
  - un plancher, pour ne pas ouvrir un carry qui ne couvre même pas ses frais.

Usage : python backtest_carry_production.py
"""

import json
import os

import pandas as pd

import config
import binance_client
from backtest_carry_funding import charger_funding, COUT_ALLER_RETOUR_TOTAL_PCT
from backtest_carry_frontiere import simuler as simuler_bloc, annees_positives

START = "2020-08-11"


def construire_funding():
    series = {}
    for pair in config.PAIRS:
        lignes = charger_funding(binance_client.pair_to_symbol(pair))
        if not lignes or len(lignes) < 500:
            continue
        df = pd.DataFrame(lignes)
        df["date"] = pd.to_datetime(df["fundingTime"], unit="ms").dt.normalize()
        df["taux"] = df["fundingRate"].astype(float) * 100
        series[pair] = df.groupby("date")["taux"].sum()
    return pd.DataFrame(series).sort_index().loc[START:]


def simuler_echelonne(funding, n_places, duree, fenetre=None, plafond=None, plancher=None):
    """
    Forme livrable. Chaque jour : on ferme ce qui arrive à échéance, puis on
    remplit les places libres avec les paires au financement passé le plus
    élevé qui ne sont pas déjà détenues.

    `fenetre` est la profondeur du classement (par défaut, la durée de
    détention). `plafond` et `plancher` filtrent sur le financement attendu.
    """
    fenetre = fenetre or duree
    passe = funding.rolling(fenetre).mean()
    detenues = {}  # paire -> index de clôture
    trades = []

    for i in range(fenetre + 1, len(funding) - duree):
        for pair, echeance in list(detenues.items()):
            if i >= echeance:
                del detenues[pair]

        libres = n_places - len(detenues)
        if libres <= 0:
            continue

        classement = passe.iloc[i].dropna()
        if plafond is not None:
            classement = classement[classement <= plafond]
        if plancher is not None:
            classement = classement[classement >= plancher]
        classement = classement[~classement.index.isin(detenues)]
        if classement.empty:
            continue

        for pair in classement.nlargest(libres).index:
            encaisse = funding[pair].iloc[i + 1: i + 1 + duree].sum()
            if pd.isna(encaisse):
                continue
            detenues[pair] = i + duree
            trades.append({
                "date": funding.index[i],
                "pair": pair,
                "attendu": classement[pair] * duree,   # ce qu'on annonce
                "net": encaisse - COUT_ALLER_RETOUR_TOTAL_PCT,
            })
    return pd.DataFrame(trades)


def resumer(t, label, n_jours, regime=None, muet=False):
    if t.empty or len(t) < 40:
        print(f"  {label:<40} : trop peu de signaux")
        return None
    pos, tot = annees_positives(t)
    ligne = (f"  {label:<40} | {len(t)/n_jours:>6.2f} | {t['net'].mean():>+7.3f} % | "
             f"{100*(t['net']>0).mean():>6.1f} % | {t['net'].min():>+7.2f} % | {pos}/{tot}")
    if regime is not None:
        b = t[~t["date"].map(lambda d: regime.get(d, False))]
        ligne += f" | baissier {b['net'].mean():>+6.3f} % ({100*(b['net']>0).mean():>4.1f} %)" if len(b) > 20 else ""
    if not muet:
        print(ligne)
    return t


if __name__ == "__main__":
    print("Chargement du financement...", flush=True)
    funding = construire_funding()
    n_jours = len(funding)

    btc_path = os.path.join(os.path.dirname(__file__), "data", "long_daily", "BTCUSDT_1d.json")
    with open(btc_path, "r", encoding="utf-8") as f:
        bougies = json.load(f)
    btc = pd.DataFrame(bougies, columns=["ts_ms", "o", "h", "l", "close", "v"])
    btc["date"] = pd.to_datetime(btc["ts_ms"], unit="ms").dt.normalize()
    btc = btc.set_index("date")["close"].astype(float)
    haussier = (btc > btc.rolling(200).mean()).reindex(funding.index).fillna(False).astype(bool)
    regime = haussier.to_dict()

    print(f"{funding.shape[1]} paires, {n_jours} jours, filtre de tendance ouvert "
          f"{100*haussier.mean():.0f} % du temps\n")

    print("=== BLOC CONTRE ÉCHELONNÉ : la forme livrable mesure-t-elle pareil ? ===")
    print(f"  {'configuration':<40} | {'sig/j':>6} | {'net':>8} | {'gagn.':>7} | {'pire':>8} | ann.+")
    for n_places, duree in ((10, 30), (15, 21), (15, 30), (20, 21)):
        resumer(simuler_bloc(funding, n_places, duree), f"bloc — {n_places} places / {duree} j", n_jours)
        resumer(simuler_echelonne(funding, n_places, duree),
                f"échelonné — {n_places} places / {duree} j", n_jours)
        print()

    print("=== EFFET DES GARDE-FOUS SUR LA FORME ÉCHELONNÉE (15 places / 21 j) ===")
    print("Le plafond écarte les financements extrêmes, qui signalent une manie plutôt")
    print("qu'une bonne affaire, et où se logent les pertes rares et énormes.\n")
    print(f"  {'garde-fou':<40} | {'sig/j':>6} | {'net':>8} | {'gagn.':>7} | {'pire':>8} | ann.+")
    for label, kw in (
        ("aucun", {}),
        ("plafond 0,15 %/jour", {"plafond": 0.15}),
        ("plafond 0,10 %/jour", {"plafond": 0.10}),
        ("plancher 0,015 %/jour (couvre les frais)", {"plancher": 0.015}),
        ("plafond 0,15 % + plancher 0,015 %", {"plafond": 0.15, "plancher": 0.015}),
        ("plafond 0,10 % + plancher 0,015 %", {"plafond": 0.10, "plancher": 0.015}),
    ):
        resumer(simuler_echelonne(funding, 15, 21, **kw), label, n_jours, regime)

    print("\n=== FRONTIÈRE DE LA FORME LIVRABLE ===")
    print("Avec N places et D jours de détention, on ouvre N/D position par jour.")
    print("C'est le levier direct de la quantité.\n")
    print(f"  {'places':>7} {'durée':>7} {'théorique':>10} | {'sig/j':>6} | {'net':>8} | "
          f"{'gagn.':>7} | {'pire':>8} | ann.+")
    retenues = {}
    for n_places in (10, 15, 20, 25, 30):
        for duree in (14, 21, 30):
            t = simuler_echelonne(funding, n_places, duree, plafond=0.15, plancher=0.015)
            if t.empty or len(t) < 40:
                continue
            pos, tot = annees_positives(t)
            retenues[(n_places, duree)] = t
            print(f"  {n_places:>7} {duree:>6} j {n_places/duree:>9.2f} | {len(t)/n_jours:>6.2f} | "
                  f"{t['net'].mean():>+7.3f} % | {100*(t['net']>0).mean():>6.1f} % | "
                  f"{t['net'].min():>+7.2f} % | {pos}/{tot}")

    print("\n=== EN MARCHÉ BAISSIER, FORME LIVRABLE AVEC GARDE-FOUS ===")
    print("C'est le seul intérêt du carry pour ce canal : produire quand rien d'autre ne produit.\n")
    jours_baisse = int((~haussier).sum())
    print(f"  {'places':>7} {'durée':>7} | {'sig/j':>6} | {'net':>8} | {'gagn.':>7} | {'n':>6}")
    for (n_places, duree), t in retenues.items():
        b = t[~t["date"].map(lambda d: regime.get(d, False))]
        if len(b) < 30:
            continue
        print(f"  {n_places:>7} {duree:>6} j | {b['date'].count()/jours_baisse:>6.2f} | "
              f"{b['net'].mean():>+7.3f} % | {100*(b['net']>0).mean():>6.1f} % | {len(b):>6}")

    print("\n=== CE QU'ON ANNONCE CONTRE CE QU'ON ENCAISSE ===")
    print("Le financement attendu est annoncé à l'abonné. S'il est systématiquement")
    print("supérieur au réalisé, l'annonce est une promesse qu'on ne tient pas.\n")
    t = simuler_echelonne(funding, 15, 21, plafond=0.15, plancher=0.015)
    brut = t["net"] + COUT_ALLER_RETOUR_TOTAL_PCT
    print(f"  Attendu moyen à l'émission : {t['attendu'].mean():+.3f} % sur la période")
    print(f"  Encaissé moyen (avant frais) : {brut.mean():+.3f} %")
    print(f"  Écart : {brut.mean() - t['attendu'].mean():+.3f} point")
    print(f"  Positions où le réalisé atteint au moins l'annoncé : {100*(brut >= t['attendu']).mean():.0f} %")
    print(f"  Corrélation annoncé / réalisé : {t['attendu'].corr(brut):+.3f}")
