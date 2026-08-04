"""
Le carry tient-il en marché baissier, et combien de signaux peut-il donner ?

Le résultat à valider. La sélection des paires au financement passé le plus
élevé rend +1,04 % à +1,17 % net par position sur 30 jours, avec 86 à 91 % de
positions gagnantes et SEPT années positives sur sept. C'est la première chose
du projet qui ne perd aucune année — le momentum, lui, perd 2022, 2025 et 2026.

Deux questions décident de tout, et aucune n'a encore de réponse :

  1. EN MARCHÉ BAISSIER. Le financement moyen tombe à -1,3 %/an en 2022 et
     -2,1 %/an en 2026. Si la sélection ne fait que suivre le marché — carry
     rentable quand ça monte, nul quand ça baisse — elle ne résout pas le trou
     des 41 % et ce n'est qu'un momentum déguisé. Il faut donc mesurer
     séparément les périodes où le filtre de tendance est FERMÉ, c'est-à-dire
     exactement celles où le canal n'a rien à dire aujourd'hui.

  2. LA QUANTITÉ. À top 10 sur 30 jours on n'a que 0,32 position par jour. Le
     canal vise 2 à 6 signaux par jour. Élargir le groupe de tête dégrade
     forcément la sélection : reste à savoir à quelle vitesse, et où se situe
     le point de rupture.

Trois vérifications complémentaires, parce qu'un résultat à 90 % de réussite
mérite une méfiance proportionnelle :

  - Un TÉMOIN ALÉATOIRE, comme pour toutes les autres familles. Si prendre des
    paires au hasard rapporte autant, la sélection n'apporte rien et il reste
    seulement un effet de marché.
  - La SENSIBILITÉ AUX FRAIS. 0,20 % l'aller-retour sur deux jambes est
    l'hypothèse de base ; à 0,40 % un carry court n'a plus aucun sens.
  - Le PIRE CAS. Une moyenne de +1 % avec 90 % de réussite peut cacher des
    pertes rares mais énormes. C'est la forme classique d'une stratégie qui
    ramasse des pièces devant un rouleau compresseur, et il faut le savoir.

Usage : python backtest_carry_frontiere.py
"""

import json
import os
import random

import pandas as pd

import config
import binance_client
from backtest_carry_funding import charger_funding, COUT_ALLER_RETOUR_TOTAL_PCT

START = "2020-08-11"
N_PERMUTATIONS = 200


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


def simuler(funding, n_top, duree, cout=COUT_ALLER_RETOUR_TOTAL_PCT, aleatoire=None):
    """
    Sélection sur le financement passé UNIQUEMENT, encaissement de ce qui vient
    réellement ensuite. `aleatoire` remplace la sélection par un tirage au sort
    de même taille : c'est le témoin.
    """
    rng = random.Random(aleatoire) if aleatoire is not None else None
    passe = funding.rolling(duree).mean()
    trades = []
    for i in range(duree + 1, len(funding) - duree, duree):
        classement = passe.iloc[i].dropna()
        if len(classement) < 10:
            continue
        choix = (rng.sample(list(classement.index), min(n_top, len(classement)))
                 if rng is not None else list(classement.nlargest(n_top).index))
        for pair in choix:
            encaisse = funding[pair].iloc[i + 1: i + 1 + duree].sum()
            if pd.isna(encaisse):
                continue
            trades.append({"date": funding.index[i], "pair": pair, "net": encaisse - cout})
    return pd.DataFrame(trades)


def annees_positives(t):
    lignes = [(y, t[t["date"].dt.year == y]["net"]) for y in sorted(t["date"].dt.year.unique())]
    lignes = [(y, s) for y, s in lignes if len(s) >= 5]
    return sum(1 for _, s in lignes if s.mean() > 0), len(lignes)


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

# ==========================================================================
# 1. LA question : le carry tient-il quand le filtre est fermé ?
# ==========================================================================
print("=== LE CARRY EN MARCHÉ BAISSIER — LA QUESTION QUI DÉCIDE ===")
print("Si la colonne BAISSIER est positive, le canal a enfin quelque chose à")
print("diffuser pendant les 41 % de fermeture. Sinon ce n'est qu'un momentum déguisé.\n")
print(f"  {'top':>4} {'durée':>7} | {'HAUSSIER':>22} | {'BAISSIER':>22}")
print(f"  {'':>4} {'':>7} | {'net':>9} {'gagn.':>7} {'n':>5} | {'net':>9} {'gagn.':>7} {'n':>5}")
for n_top in (5, 10, 20):
    for duree in (14, 30):
        t = simuler(funding, n_top, duree)
        if t.empty:
            continue
        h = t[t["date"].map(lambda d: regime.get(d, False))]
        b = t[~t["date"].map(lambda d: regime.get(d, False))]
        if h.empty or b.empty:
            continue
        print(f"  {n_top:>4} {duree:>6} j | {h['net'].mean():>+8.3f} % {100*(h['net']>0).mean():>6.1f} % "
              f"{len(h):>5} | {b['net'].mean():>+8.3f} % {100*(b['net']>0).mean():>6.1f} % {len(b):>5}")

# ==========================================================================
# 2. La frontière quantité / qualité
# ==========================================================================
print("\n=== JUSQU'OÙ POUSSER LA QUANTITÉ ? ===")
print("Le canal vise 2 à 6 signaux par jour. Voici ce que chaque élargissement coûte.\n")
print(f"  {'top':>4} {'durée':>7} | {'signaux/j':>10} | {'net moyen':>10} | {'gagnants':>9} | "
      f"{'années+':>8} | {'pire':>8}")
frontiere = {}
for n_top in (5, 10, 15, 20, 25, 30):
    for duree in (7, 14, 21, 30):
        t = simuler(funding, n_top, duree)
        if len(t) < 50:
            continue
        pos, tot = annees_positives(t)
        par_jour = len(t) / n_jours
        frontiere[(n_top, duree)] = (par_jour, t["net"].mean(), pos, tot)
        print(f"  {n_top:>4} {duree:>6} j | {par_jour:>9.2f} | {t['net'].mean():>+9.3f} % | "
              f"{100*(t['net']>0).mean():>8.1f} % | {pos:>4}/{tot:<3} | {t['net'].min():>+7.2f} %")

# ==========================================================================
# 3. Témoin aléatoire
# ==========================================================================
print(f"\n=== TÉMOIN ALÉATOIRE ({N_PERMUTATIONS} tirages) ===")
print("La sélection par financement passé apporte-t-elle vraiment quelque chose,")
print("ou suffirait-il de prendre des paires au hasard ?\n")
for n_top, duree in ((10, 30), (20, 14)):
    reel = simuler(funding, n_top, duree)
    if reel.empty:
        continue
    tirages = []
    for graine in range(N_PERMUTATIONS):
        t = simuler(funding, n_top, duree, aleatoire=graine)
        if not t.empty:
            tirages.append(t["net"].mean())
    mieux = sum(1 for v in tirages if v >= reel["net"].mean())
    p = mieux / len(tirages)
    print(f"  top {n_top}, {duree} j : sélection {reel['net'].mean():+.3f} % | "
          f"hasard {sum(tirages)/len(tirages):+.3f} % | p = {p:.3f} | "
          f"{'BAT LE HASARD' if p < 0.05 else 'indiscernable'}")

# ==========================================================================
# 4. Sensibilité aux frais et pire cas
# ==========================================================================
print("\n=== SENSIBILITÉ AUX FRAIS ===")
print("0,20 % couvre deux jambes en aller-retour à tarif standard. Un abonné")
print("moins bien traité paiera plus : à partir de quel niveau ça ne vaut plus rien ?\n")
print(f"  {'frais':>7} | " + " | ".join(f"top 10 / {d} j" for d in (14, 30)))
for cout in (0.20, 0.30, 0.40, 0.60):
    ligne = []
    for duree in (14, 30):
        t = simuler(funding, 10, duree, cout=cout)
        pos, tot = annees_positives(t)
        ligne.append(f"{t['net'].mean():+7.3f} % ({pos}/{tot})")
    print(f"  {cout:>6.2f} % | " + " | ".join(ligne))

print("\n=== LE PIRE CAS ===")
print("90 % de réussite peut cacher de rares pertes énormes. C'est la forme")
print("classique d'une stratégie qui ramasse des pièces devant un rouleau compresseur.\n")
t = simuler(funding, 10, 30)
q = t["net"].quantile([0.01, 0.05, 0.25, 0.5, 0.75, 0.99])
print(f"  déciles extrêmes : 1 % {q[0.01]:+.2f} % | 5 % {q[0.05]:+.2f} % | 25 % {q[0.25]:+.2f} % | "
      f"médiane {q[0.5]:+.2f} % | 75 % {q[0.75]:+.2f} % | 99 % {q[0.99]:+.2f} %")
print(f"  pire position : {t['net'].min():+.2f} %   |   meilleure : {t['net'].max():+.2f} %")
print(f"  le pire 1 % des positions pèse {abs(t[t['net'] <= q[0.01]]['net'].sum()) / t['net'].sum() * 100:.0f} % "
      f"du gain total en valeur absolue")
