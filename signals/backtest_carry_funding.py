"""
Le carry de financement : la seule piste qui ne dépend pas du sens du marché.

Où on en est. Six façons de gagner en marché baissier ont été testées et
réfutées au témoin aléatoire : momentum transversal à la vente (p = 1,000),
cassure de canal à la baisse (p = 0,583), rebond de capitulation (p = 0,650),
et les deux familles retenues (cassure haussière, expansion de volatilité)
rendent +5,93 % et +5,58 % en marché haussier contre -1,23 % et -2,65 % en
baissier. Le constat est net : en crypto, il n'existe pas d'avantage
DIRECTIONNEL en marché baissier, dans un sens comme dans l'autre.

Le carry est d'une nature différente. On détient le spot et on vend le
perpétuel à découvert pour le même montant : la position ne gagne ni ne perd
quand le prix bouge, les deux jambes s'annulent. Le rendement vient uniquement
du FINANCEMENT, ce taux versé toutes les 8 heures entre acheteurs et vendeurs
de perpétuels. Historiquement il est majoritairement positif — les acheteurs à
effet de levier étant plus nombreux — donc c'est le vendeur qui encaisse.

Si ça tient, le canal aurait enfin quelque chose à diffuser en permanence, y
compris pendant les 41 % de fermeture du filtre de tendance.

Ce qu'il faut vérifier honnêtement, et qui tue la plupart des stratégies de
carry en crypto :

  1. Le financement est-il RÉELLEMENT positif en moyenne, et surtout : reste-t-il
     positif pendant les marchés baissiers ? Si le carry ne paie que pendant les
     hausses, il ne résout rien et n'est qu'un momentum déguisé.
  2. Les frais. Ouvrir un carry coûte deux allers-retours (spot + perpétuel), et
     le fermer aussi. À 0,10 % l'aller-retour par jambe, il faut 0,20 % de
     financement cumulé pour rentrer dans ses frais. À un taux typique de
     0,01 % toutes les 8 heures, soit 0,03 %/jour, cela demande une semaine
     rien que pour être à l'équilibre.
  3. Le risque réel. Ce n'est pas « sans risque » : liquidation de la jambe
     short si la marge est insuffisante, écart de prix entre spot et perpétuel,
     et risque de plateforme. Aucune communication ne devra prétendre l'inverse.

Données : endpoint public Binance Futures, aucune clé requise.

Usage : python backtest_carry_funding.py
"""

import json
import os
import time
import urllib.request

import pandas as pd

import config
import binance_client

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "funding")
START = "2020-08-11"
# Un aller-retour par jambe, deux jambes : ouvrir puis fermer un carry coûte
# donc 2 x 0,10 %. C'est le seuil que le financement doit dépasser.
COUT_ALLER_RETOUR_TOTAL_PCT = 0.20


def charger_funding(symbole):
    """
    Historique complet des taux de financement (toutes les 8 heures).
    L'endpoint rend 1000 lignes par appel, soit environ 11 mois : on pagine.
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{symbole}.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)

    lignes, curseur = [], 1590000000000  # mi-2020
    while True:
        url = (f"https://fapi.binance.com/fapi/v1/fundingRate?symbol={symbole}"
               f"&startTime={curseur}&limit=1000")
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "crypto-signals-bot"})
            lot = json.load(urllib.request.urlopen(req, timeout=30))
        except Exception:
            break
        if not lot:
            break
        lignes.extend(lot)
        suivant = lot[-1]["fundingTime"] + 1
        if suivant <= curseur or len(lot) < 1000:
            break
        curseur = suivant
        time.sleep(0.15)

    if lignes:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(lignes, f)
    return lignes


if __name__ == "__main__":
    print("Téléchargement de l'historique des taux de financement...", flush=True)
    series = {}
    for i, pair in enumerate(config.PAIRS, 1):
        symbole = binance_client.pair_to_symbol(pair)
        lignes = charger_funding(symbole)
        if not lignes or len(lignes) < 500:
            continue
        df = pd.DataFrame(lignes)
        df["date"] = pd.to_datetime(df["fundingTime"], unit="ms").dt.normalize()
        df["taux"] = df["fundingRate"].astype(float) * 100  # en %
        # Trois versements par jour : on somme pour obtenir le rendement quotidien.
        series[pair] = df.groupby("date")["taux"].sum()
        if i % 10 == 0:
            print(f"  ... {i}/{len(config.PAIRS)}", flush=True)

    funding = pd.DataFrame(series).sort_index().loc[START:]
    print(f"\n{funding.shape[1]} paires, {funding.shape[0]} jours "
          f"({funding.index[0].date()} -> {funding.index[-1].date()})\n")

    # Régime de marché, pour la question qui décide de tout.
    btc_path = os.path.join(os.path.dirname(__file__), "data", "long_daily", "BTCUSDT_1d.json")
    with open(btc_path, "r", encoding="utf-8") as f:
        bougies = json.load(f)
    btc = pd.DataFrame(bougies, columns=["ts_ms", "o", "h", "l", "close", "v"])
    btc["date"] = pd.to_datetime(btc["ts_ms"], unit="ms").dt.normalize()
    btc = btc.set_index("date")["close"].astype(float)
    haussier = (btc > btc.rolling(200).mean()).reindex(funding.index).fillna(False).astype(bool)

    print("=== LE FINANCEMENT EST-IL POSITIF, ET QUAND ? ===")
    moyen = funding.mean(axis=1)
    print(f"  Taux quotidien moyen, toutes paires : {moyen.mean():+.4f} %/jour "
          f"({moyen.mean()*365:+.1f} %/an)")
    print(f"  Jours à financement positif : {100*(moyen > 0).mean():.1f} %")
    print(f"  En marché HAUSSIER : {moyen[haussier].mean():+.4f} %/jour "
          f"({moyen[haussier].mean()*365:+.1f} %/an)")
    print(f"  En marché BAISSIER : {moyen[~haussier].mean():+.4f} %/jour "
          f"({moyen[~haussier].mean()*365:+.1f} %/an)")
    print("\n  C'est la ligne « baissier » qui décide : si elle est positive, le carry")
    print("  donne enfin quelque chose à diffuser pendant les 41 % de fermeture.\n")

    print("=== ANNÉE PAR ANNÉE ===")
    for annee in sorted({d.year for d in funding.index}):
        s = moyen[moyen.index.year == annee]
        if len(s) < 60:
            continue
        print(f"  {annee} : {s.mean():+.4f} %/jour ({s.mean()*365:>+6.1f} %/an) | "
              f"{100*(s > 0).mean():>4.1f} % de jours positifs")

    print("\n=== COMBIEN DE PAIRES OFFRENT UN CARRY VRAIMENT RENTABLE ? ===")
    print("Un carry n'a d'intérêt que si le financement cumulé sur la durée de")
    print(f"détention dépasse {COUT_ALLER_RETOUR_TOTAL_PCT:.2f} % de frais (deux jambes, aller-retour).\n")
    print(f"  {'détention':>10} | {'seuil/jour':>11} | {'occasions/jour':>15} | {'gain net moyen':>15}")
    for duree in (7, 14, 30):
        seuil = COUT_ALLER_RETOUR_TOTAL_PCT / duree
        # Financement cumulé réellement encaissé sur la fenêtre à venir, connu
        # seulement a posteriori : c'est bien ce qu'on veut mesurer ici, la
        # question de la prévisibilité vient juste après.
        cumule = funding.rolling(duree).sum().shift(-duree)
        net = cumule - COUT_ALLER_RETOUR_TOTAL_PCT
        rentables = (net > 0)
        print(f"  {duree:>9} j | {seuil:>10.4f} % | {rentables.sum(axis=1).mean():>14.2f} | "
              f"{net[rentables].stack().mean():>14.2f} %")

    print("\n=== LE FINANCEMENT PASSÉ PRÉDIT-IL LE FINANCEMENT FUTUR ? ===")
    print("C'est la vraie question : on ne peut sélectionner que sur le passé. Si le")
    print("taux d'hier ne dit rien de celui de demain, la sélection est illusoire.\n")
    for duree in (7, 14, 30):
        passe = funding.rolling(duree).mean()
        futur = funding.rolling(duree).mean().shift(-duree)
        correl = passe.corrwith(futur).mean()
        print(f"  fenêtre {duree:>2} j : corrélation passé/futur = {correl:+.3f}")

    print("\n=== STRATÉGIE RÉELLE : SÉLECTION SUR LE PASSÉ SEUL ===")
    print("On choisit chaque semaine les N paires au financement passé le plus élevé,")
    print("on tient la position `duree` jours, et on encaisse ce qui vient VRAIMENT.\n")
    print(f"  {'top':>4} {'détention':>10} | {'positions/j':>12} | {'net moyen':>10} | "
          f"{'% gagnants':>11} | années+")
    for n_top in (3, 5, 10):
        for duree in (7, 14, 30):
            passe = funding.rolling(duree).mean()
            trades = []
            for i in range(duree + 1, len(funding) - duree, duree):
                classement = passe.iloc[i].dropna()
                if len(classement) < 10:
                    continue
                for pair in classement.nlargest(n_top).index:
                    encaisse = funding[pair].iloc[i + 1: i + 1 + duree].sum()
                    if pd.isna(encaisse):
                        continue
                    trades.append({"date": funding.index[i], "pair": pair,
                                   "net": encaisse - COUT_ALLER_RETOUR_TOTAL_PCT})
            if len(trades) < 30:
                continue
            t = pd.DataFrame(trades)
            annees = [(y, t[t["date"].dt.year == y]["net"]) for y in sorted(t["date"].dt.year.unique())]
            annees = [(y, s) for y, s in annees if len(s) >= 5]
            pos = sum(1 for _, s in annees if s.mean() > 0)
            print(f"  {n_top:>4} {duree:>9} j | {len(t)/len(funding):>11.2f} | {t['net'].mean():>+9.3f} % | "
                  f"{100*(t['net'] > 0).mean():>10.1f} % | {pos}/{len(annees)}")
