"""
Un stop sur le financement rend-il l'univers élargi livrable ?

Le blocage à lever. Le carry sur les 38 paires du projet donne 0,49 signal par
jour en marché défavorable. Élargir à 118 perpétuels le ferait passer à 0,69,
avec 78,8 % de positions gagnantes — mais la pire position mesurée tombe de
-2,25 % à -68 %. Sur une position vendue comme neutre au marché, c'est
inacceptable, et c'est pour ça que l'élargissement n'a pas été livré.

D'où vient cette perte. Le financement d'un perpétuel peut s'INVERSER : lors
d'un squeeze, ce sont les vendeurs qui paient, parfois massivement et pendant
plusieurs jours. Une position ouverte pour encaisser 0,03 %/jour se met alors à
en coûter dix fois plus. Rien dans la stratégie actuelle ne l'arrête : la
position court jusqu'à son terme, 21 jours plus tard.

Le remède naturel est un stop, mais PAS un stop de prix — la position est
insensible au prix. Un stop sur le FINANCEMENT CUMULÉ : dès que la position a
coûté plus de X %, on ferme les deux jambes. C'est simple à opérer (une
vérification par jour) et ça borne mécaniquement la perte.

Ce que ce module mesure :
  1. l'effet du stop sur la pire position, sur l'espérance et sur la réussite ;
  2. si l'univers élargi devient alors livrable ;
  3. si le stop permet aussi d'ABAISSER le plancher sans danger — car c'est le
     plancher qui limite aujourd'hui la quantité (4 paires éligibles seulement
     le 04/08/2026), et le relâcher est le levier direct du débit quotidien.

Le stop coûte forcément quelque chose : il ferme des positions qui seraient
revenues. C'est le solde net qui décide, comme pour le stop de prix des
familles directionnelles — où il s'était avéré que plus le stop était serré,
plus il coûtait cher.

Usage : python backtest_carry_stop.py
"""

import json
import os
import urllib.request

import pandas as pd

from backtest_carry_funding import charger_funding, COUT_ALLER_RETOUR_TOTAL_PCT

START = "2020-08-11"
STABLES = {"USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT", "USDPUSDT"}


def univers_perpetuels(n):
    req = urllib.request.Request("https://fapi.binance.com/fapi/v1/ticker/24hr",
                                 headers={"User-Agent": "crypto-signals-bot"})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    rows = [d for d in data if d["symbol"].endswith("USDT") and d["symbol"] not in STABLES]
    rows.sort(key=lambda d: -float(d["quoteVolume"]))
    return [d["symbol"] for d in rows[:n]]


def construire(symboles):
    series = {}
    for s in symboles:
        lignes = charger_funding(s)
        if not lignes or len(lignes) < 300:
            continue
        df = pd.DataFrame(lignes)
        df["date"] = pd.to_datetime(df["fundingTime"], unit="ms").dt.normalize()
        df["taux"] = df["fundingRate"].astype(float) * 100
        series[s] = df.groupby("date")["taux"].sum()
    return pd.DataFrame(series).sort_index().loc[START:]


def simuler(funding, n_places, duree, plancher, plafond=0.15, stop=None):
    """
    Forme livrable, avec stop optionnel sur le financement cumulé.

    `stop` est exprimé en pourcentage NÉGATIF (par exemple -1.0) : dès que le
    financement cumulé depuis l'ouverture descend sous ce seuil, la position est
    fermée le jour même. Les frais restent dus dans tous les cas.
    """
    passe = funding.rolling(duree).mean()
    detenues = {}
    trades = []

    for i in range(duree + 1, len(funding) - duree):
        for pair, echeance in list(detenues.items()):
            if i >= echeance:
                del detenues[pair]

        libres = n_places - len(detenues)
        if libres <= 0:
            continue

        classement = passe.iloc[i].dropna()
        classement = classement[(classement >= plancher) & (classement <= plafond)]
        classement = classement[~classement.index.isin(detenues)]
        if classement.empty:
            continue

        for pair in classement.nlargest(libres).index:
            fenetre = funding[pair].iloc[i + 1: i + 1 + duree]
            if fenetre.isna().all():
                continue

            cumule, jours_tenus, sorti_au_stop = 0.0, 0, False
            for valeur in fenetre:
                if pd.isna(valeur):
                    continue
                cumule += valeur
                jours_tenus += 1
                if stop is not None and cumule <= stop:
                    sorti_au_stop = True
                    break

            detenues[pair] = i + jours_tenus
            trades.append({
                "date": funding.index[i], "pair": pair,
                "net": cumule - COUT_ALLER_RETOUR_TOTAL_PCT,
                "jours": jours_tenus, "stop": sorti_au_stop,
            })
    return pd.DataFrame(trades)


def annees(t):
    lignes = [(y, t[t["date"].dt.year == y]["net"]) for y in sorted(t["date"].dt.year.unique())]
    lignes = [(y, s) for y, s in lignes if len(s) >= 5]
    return sum(1 for _, s in lignes if s.mean() > 0), len(lignes)


print("Chargement (38 paires du projet, puis 118 perpétuels)...", flush=True)
large = construire(univers_perpetuels(150))
n_jours = len(large)

btc_path = os.path.join(os.path.dirname(__file__), "data", "long_daily", "BTCUSDT_1d.json")
with open(btc_path, "r", encoding="utf-8") as f:
    bougies = json.load(f)
btc = pd.DataFrame(bougies, columns=["ts_ms", "o", "h", "l", "close", "v"])
btc["date"] = pd.to_datetime(btc["ts_ms"], unit="ms").dt.normalize()
btc = btc.set_index("date")["close"].astype(float)
haussier = (btc > btc.rolling(200).mean()).reindex(large.index).fillna(False).astype(bool)
regime = haussier.to_dict()
jours_baisse = int((~haussier).sum())
print(f"{large.shape[1]} perpétuels, {n_jours} jours, {jours_baisse} défavorables\n")


def rapport(t, label):
    if t.empty or len(t) < 40:
        print(f"  {label:<30} : trop peu de positions")
        return
    pos, tot = annees(t)
    b = t[~t["date"].map(lambda d: regime.get(d, False))]
    part_stop = 100 * t["stop"].mean()
    print(f"  {label:<30} | {len(t)/n_jours:>6.2f} | {t['net'].mean():>+7.3f} % | "
          f"{100*(t['net']>0).mean():>6.1f} % | {t['net'].min():>+8.2f} % | {part_stop:>5.1f} % | "
          f"{pos}/{tot} | {len(b)/jours_baisse:>5.2f}/j {b['net'].mean():>+6.3f} %")


print("=== EFFET DU STOP SUR L'UNIVERS ÉLARGI (20 places, 21 jours) ===")
print("Sans stop, la pire position atteint -68 % : c'est ce qui bloquait la livraison.\n")
print(f"  {'stop sur financement cumulé':<30} | {'sig/j':>6} | {'net':>8} | {'gagn.':>7} | "
      f"{'pire':>9} | {'%stop':>6} | ann.+ | {'défavorable':>17}")
for stop in (None, -3.0, -2.0, -1.5, -1.0, -0.5):
    label = "aucun" if stop is None else f"{stop:.1f} %"
    rapport(simuler(large, 20, 21, plancher=0.015, stop=stop), label)

print("\n=== LE STOP PERMET-IL D'ABAISSER LE PLANCHER ? ===")
print("C'est le plancher qui limite la quantité : le 04/08/2026, seules 4 paires")
print("le dépassaient sur 37. L'abaisser est le levier direct du débit quotidien,")
print("à condition que le stop protège du risque ainsi laissé entrer.\n")
print(f"  {'plancher':<30} | {'sig/j':>6} | {'net':>8} | {'gagn.':>7} | "
      f"{'pire':>9} | {'%stop':>6} | ann.+ | {'défavorable':>17}")
for plancher in (0.015, 0.010, 0.007, 0.005, 0.0):
    rapport(simuler(large, 20, 21, plancher=plancher, stop=-1.5),
            f"{plancher:.3f} %/jour (stop -1,5 %)")

print("\n=== COMBIEN DE PLACES, UNE FOIS LE RISQUE BORNÉ ? ===")
print(f"  {'places':<30} | {'sig/j':>6} | {'net':>8} | {'gagn.':>7} | "
      f"{'pire':>9} | {'%stop':>6} | ann.+ | {'défavorable':>17}")
for places in (20, 30, 40, 60):
    rapport(simuler(large, places, 21, plancher=0.007, stop=-1.5), f"{places} places")

print("\n=== COMBINAISONS LES PLUS PRODUCTIVES, DÉTAIL DU RÉGIME DÉFAVORABLE ===")
print("L'objectif est un débit régulier autour de 3 signaux par jour, y compris")
print("quand le marché baisse. Voici ce que le carry seul peut y contribuer.\n")
print(f"  {'configuration':<30} | {'défavorable':>12} | {'net':>8} | {'gagn.':>7} | {'pire':>9}")
for places, duree, plancher in ((30, 21, 0.007), (40, 21, 0.007), (40, 14, 0.007),
                                (60, 21, 0.005), (60, 14, 0.005)):
    t = simuler(large, places, duree, plancher=plancher, stop=-1.5)
    if t.empty or len(t) < 40:
        continue
    b = t[~t["date"].map(lambda d: regime.get(d, False))]
    pos, tot = annees(t)
    print(f"  {places} places / {duree} j / {plancher:.3f} %".ljust(32) +
          f"| {len(b)/jours_baisse:>11.2f} | {b['net'].mean():>+7.3f} % | "
          f"{100*(b['net']>0).mean():>6.1f} % | {t['net'].min():>+8.2f} %  (année+ {pos}/{tot})")
