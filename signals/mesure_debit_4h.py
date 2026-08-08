"""
Combien de signaux le momentum 4H ajoute-t-il pendant les silences ?

C'est le chiffre qui manque au régime défavorable. Le produit y annonce
« 1,15 signal par jour », qui est le rythme du carry seul — mesuré avant que le
momentum 4H n'existe. Or ce moteur ne travaille QUE dans ce régime : le chiffre
publié sous-estime donc précisément la période où un abonné doute le plus.

Le cache 4 h ne remonte qu'à août 2023, contre six ans pour les bougies
journalières. Trois ans suffisent ici : on ne mesure pas une performance mais
un DÉBIT, et le débit ne dépend que de la rotation du classement et du plafond.

La détention est simulée (`already_open`), comme en production : sans elle, le
moteur reproposerait ses deux mêmes paires tous les jours.
"""

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
import momentum_4h as m4h
from backtest_familles import CACHE_DIR
import binance_client
import json

H4_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "h4")

# 18 bougies de 4 h = 3 jours, la durée validée (config.M4H_HOLD_BOUGIES).
DETENTION_HEURES = config.M4H_HOLD_BOUGIES * 4


def charger_4h() -> dict:
    out = {}
    for pair in config.PAIRS:
        path = os.path.join(H4_DIR, f"{binance_client.pair_to_symbol(pair)}_4h.json")
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            candles = json.load(f)
        if not candles or len(candles) < 400:
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "close", "volume"])
        df["date"] = pd.to_datetime(df["ts_ms"], unit="ms")
        out[pair] = df.set_index("date")[["open", "high", "low", "close", "volume"]].astype(float)
    return out


def main() -> int:
    candles = charger_4h()
    btc = candles.get("BTC/USDT")
    if btc is None:
        print("BTC/USDT absent du cache 4 h : mesure impossible.")
        return 1

    # Un passage par jour, comme en production (main.py). On se place à 00:00
    # UTC et on ne donne au moteur que les bougies closes à cet instant.
    jours = sorted({d.normalize() for d in btc.index})
    jours = [j for j in jours if len(btc.loc[:j]) >= 250]

    detenues: dict = {}
    jours_defavorables = 0
    emis = 0
    jours_avec_signal = 0

    for j in jours:
        for pair, fin in list(detenues.items()):
            if j >= fin:
                del detenues[pair]

        tranche = {p: df.loc[:j] for p, df in candles.items() if len(df.loc[:j]) >= 250}
        btc_tranche = tranche.get("BTC/USDT")
        if btc_tranche is None or len(tranche) < config.M4H_MIN_RANKED_PAIRS:
            continue

        if m4h.marche_defavorable(btc_tranche) is not True:
            continue
        jours_defavorables += 1

        signaux = m4h.detect_momentum_4h_signals(tranche, btc_tranche, already_open=set(detenues))
        # L'arbitre plafonne ce moteur à QUOTA_OBSERVATION_MAX (il est en
        # observation). M4H_TOP_N vaut déjà 2, mais le plafond doit apparaître
        # ici aussi : c'est lui qui fait foi en production.
        retenus = signaux[: config.QUOTA_OBSERVATION_MAX]
        for s in retenus:
            detenues[s["pair"]] = j + pd.Timedelta(hours=DETENTION_HEURES)
        emis += len(retenus)
        if retenus:
            jours_avec_signal += 1

    print(f"Jours défavorables mesurés : {jours_defavorables} ({jours[0].date()} → {jours[-1].date()})")
    if jours_defavorables:
        print(f"  signaux momentum 4H délivrés : {emis} soit {emis / jours_defavorables:.2f} / jour")
        print(f"  jours avec au moins un signal : {jours_avec_signal} "
              f"({100 * jours_avec_signal / jours_defavorables:.1f} %)")
        print()
        print(f"  RÉGIME DÉFAVORABLE, total reçu : {1.15 + emis / jours_defavorables:.2f} / jour")
        print("  (carry 1,15 mesuré sur 6 ans + momentum 4H ci-dessus)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
