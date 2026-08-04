"""
Élargir l'univers du carry : plus de signaux SANS perdre en sélectivité.

Le trou à combler. Le système complet donne 3,25 signaux par jour en marché
favorable, mais seulement 0,31 pendant les 43 % de fermeture du filtre de
tendance. La seule famille qui vit dans ces périodes est le carry de
financement, et elle est aujourd'hui limitée aux 38 paires de l'univers du
projet, dont on prend les 10 meilleures.

Le raisonnement, le même qui a échoué pour le momentum et qui devrait réussir
ici. Prendre une plus grande part du même univers dilue la sélection : top 20
sur 38 tombe à +0,122 % en marché baissier contre +0,312 % pour top 10, et la
pire position passe de -2,25 % à -35,69 %. En revanche, prendre la MÊME part
d'un univers plus large ne dilue rien : top 15 sur 150 paires sélectionne 10 %
de l'univers, soit une sélectivité MEILLEURE que top 10 sur 38 (26 %), tout en
donnant 50 % de signaux supplémentaires.

Pourquoi ça devrait mieux marcher ici que pour le momentum. L'élargissement
avait été écarté côté momentum parce que les paires les plus liquides
d'aujourd'hui n'existaient pas en 2020 : sélectionner l'univers sur le volume
actuel introduisait un look-ahead massif. Le carry est différent sur deux
points. D'abord son signal — le taux de financement — ne dépend pas du cours,
donc pas du fait qu'une paire ait survécu ou explosé. Ensuite un perpétuel
existe ou n'existe pas : on peut vérifier date par date quelles paires étaient
cotées, sans rien supposer.

Trois vérifications indispensables :
  1. La sélectivité constante tient-elle vraiment ? Même part, univers plus
     large, la qualité doit rester identique.
  2. Le résultat tient-il EN MARCHÉ BAISSIER ? C'est le seul intérêt de
     l'exercice.
  3. Les petites paires sont-elles exécutables ? Un carry sur un perpétuel sans
     profondeur est un signal que personne ne peut suivre.

Usage : python backtest_carry_univers.py
"""

import json
import os
import time
import urllib.request

import pandas as pd

from backtest_carry_funding import charger_funding, COUT_ALLER_RETOUR_TOTAL_PCT
from backtest_carry_frontiere import simuler, annees_positives

START = "2020-08-11"
N_PERPS_CIBLE = 150
STABLES = {"USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT", "USDPUSDT"}


def perpetuels_par_volume(n):
    """Perpétuels USDT les plus échangés, hors stablecoins."""
    req = urllib.request.Request("https://fapi.binance.com/fapi/v1/ticker/24hr",
                                 headers={"User-Agent": "crypto-signals-bot"})
    data = json.load(urllib.request.urlopen(req, timeout=30))
    rows = [d for d in data if d["symbol"].endswith("USDT") and d["symbol"] not in STABLES]
    rows.sort(key=lambda d: -float(d["quoteVolume"]))
    return [(d["symbol"], float(d["quoteVolume"])) for d in rows[:n]]


print("Récupération de la liste des perpétuels...", flush=True)
perps = perpetuels_par_volume(N_PERPS_CIBLE)
volumes = dict(perps)
print(f"{len(perps)} perpétuels visés. Téléchargement du financement "
      f"(déjà en cache pour les 38 paires du projet)...", flush=True)

series = {}
for i, (symbole, _v) in enumerate(perps, 1):
    lignes = charger_funding(symbole)
    if not lignes or len(lignes) < 300:
        continue
    df = pd.DataFrame(lignes)
    df["date"] = pd.to_datetime(df["fundingTime"], unit="ms").dt.normalize()
    df["taux"] = df["fundingRate"].astype(float) * 100
    series[symbole] = df.groupby("date")["taux"].sum()
    if i % 25 == 0:
        print(f"  ... {i}/{len(perps)}", flush=True)

funding = pd.DataFrame(series).sort_index().loc[START:]
n_jours = len(funding)
print(f"\n{funding.shape[1]} perpétuels avec un historique exploitable, {n_jours} jours\n")

# Régime de marché.
btc_path = os.path.join(os.path.dirname(__file__), "data", "long_daily", "BTCUSDT_1d.json")
with open(btc_path, "r", encoding="utf-8") as f:
    bougies = json.load(f)
btc = pd.DataFrame(bougies, columns=["ts_ms", "o", "h", "l", "close", "v"])
btc["date"] = pd.to_datetime(btc["ts_ms"], unit="ms").dt.normalize()
btc = btc.set_index("date")["close"].astype(float)
haussier = (btc > btc.rolling(200).mean()).reindex(funding.index).fillna(False).astype(bool)
regime = haussier.to_dict()

# Combien de perpétuels cotaient réellement à chaque date ? Une paire absente
# ne peut pas être sélectionnée : c'est géré par le dropna() de `simuler`, mais
# il faut le savoir pour interpréter les comptes.
cotes = funding.notna().sum(axis=1)
print("Perpétuels cotés simultanément :")
for annee in sorted({d.year for d in funding.index}):
    s = cotes[cotes.index.year == annee]
    print(f"  {annee} : {s.min():>3} au minimum, {s.max():>3} au maximum")

print("\n=== SÉLECTIVITÉ CONSTANTE, UNIVERS CROISSANT ===")
print("Même part de l'univers, univers plus large. Si la thèse tient, la qualité")
print("reste identique et le nombre de signaux augmente proportionnellement.\n")
print(f"  {'univers':>9} {'top':>5} {'part':>7} | {'signaux/j':>10} | {'net moyen':>10} | "
       f"{'gagnants':>9} | {'années+':>8} | {'pire':>8}")
for taille in (38, 60, 100, funding.shape[1]):
    if taille > funding.shape[1]:
        continue
    # Les colonnes sont déjà triées par volume décroissant.
    sous = funding.iloc[:, :taille]
    top = max(5, round(taille * 0.26))  # 26 % = la part actuelle (10 sur 38)
    t = simuler(sous, top, 30)
    if len(t) < 50:
        continue
    pos, tot = annees_positives(t)
    print(f"  {taille:>9} {top:>5} {100*top/taille:>6.0f} % | {len(t)/n_jours:>9.2f} | "
          f"{t['net'].mean():>+9.3f} % | {100*(t['net']>0).mean():>8.1f} % | {pos:>4}/{tot:<3} | "
          f"{t['net'].min():>+7.2f} %")

print("\n=== À UNIVERS MAXIMAL : LA VRAIE FRONTIÈRE ===")
print(f"  {'top':>5} {'part':>7} {'durée':>7} | {'signaux/j':>10} | {'net moyen':>10} | "
      f"{'gagnants':>9} | {'années+':>8} | {'pire':>8}")
total = funding.shape[1]
meilleurs = {}
for top in (10, 15, 20, 30, 40):
    for duree in (14, 21, 30):
        t = simuler(funding, top, duree)
        if len(t) < 50:
            continue
        pos, tot = annees_positives(t)
        meilleurs[(top, duree)] = t
        print(f"  {top:>5} {100*top/total:>6.0f} % {duree:>6} j | {len(t)/n_jours:>9.2f} | "
              f"{t['net'].mean():>+9.3f} % | {100*(t['net']>0).mean():>8.1f} % | {pos:>4}/{tot:<3} | "
              f"{t['net'].min():>+7.2f} %")

print("\n=== EN MARCHÉ BAISSIER — LE SEUL INTÉRÊT DE L'EXERCICE ===")
print(f"  {'top':>5} {'durée':>7} | {'signaux/j':>10} | {'net moyen':>10} | {'gagnants':>9} | {'n':>6}")
jours_baisse = int((~haussier).sum())
for (top, duree), t in meilleurs.items():
    b = t[~t["date"].map(lambda d: regime.get(d, False))]
    if len(b) < 30:
        continue
    print(f"  {top:>5} {duree:>6} j | {len(b)/jours_baisse:>9.2f} | {b['net'].mean():>+9.3f} % | "
          f"{100*(b['net']>0).mean():>8.1f} % | {len(b):>6}")

print("\n=== EXÉCUTABILITÉ : LES PETITES PAIRES SONT-ELLES SUIVABLES ? ===")
print("Un carry sur un perpétuel sans profondeur est un signal que personne ne")
print("peut suivre. Voici le volume quotidien par tranche de l'univers.\n")
noms = list(funding.columns)
for a, b in ((0, 38), (38, 75), (75, 110), (110, len(noms))):
    bloc = noms[a:b]
    if not bloc:
        continue
    vols = sorted(volumes.get(s, 0) / 1e6 for s in bloc)
    print(f"  rangs {a+1:>3}-{b:<3} : volume médian {vols[len(vols)//2]:>8.1f} M$/j "
          f"(de {vols[0]:.1f} à {vols[-1]:.0f})")
