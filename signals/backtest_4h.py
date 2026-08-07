"""
Le momentum en 4 heures : la dernière piste sérieuse pour le débit.

Pourquoi cette piste maintenant, et pourquoi elle n'a jamais été testée.

Les notes du projet contiennent cette observation : « la stratégie se dégrade du
1h vers le 4h ». J'en avais conclu que les unités de temps courtes ne valaient
rien, et tout a été construit en journalier. Mais cette mesure a été faite sur
l'ANCIENNE stratégie — celle dont il a ensuite été prouvé que le sens était
inversé (elle achetait le RSI bas, alors que c'est le RSI haut qui performe).

Une stratégie prise à contresens se dégrade nécessairement quand le bruit
diminue et que le vrai phénomène s'exprime. Cette « preuve » était donc un
indice de plus que le sens était faux, pas que le 4h était mauvais. Le momentum
DANS LE BON SENS en 4 heures n'a jamais été mesuré.

L'enjeu est le débit. Le journalier plafonne à 1,14 signal par jour filtre
ouvert, et zéro quand il est fermé. Six bougies par jour au lieu d'une, c'est
potentiellement six fois plus d'occasions.

L'objection évidente est celle des frais, et elle ne tient pas ici. À 0,10 %
l'aller-retour contre des mouvements de 1 à 2 % sur quatre heures, la couverture
est de dix à vingt fois. C'est très différent du 1h intrajournalier, qui payait
5 à 10 fois son edge en frais (voir backtest_timeframes.py).

Trois questions, dans l'ordre :
  1. Le momentum transversal fonctionne-t-il en 4 heures ?
  2. Combien de signaux par jour, et à quelle qualité ?
  3. Fonctionne-t-il quand le marché est DÉFAVORABLE ? C'est la seule chose qui
     changerait vraiment la situation actuelle.

Protocole inchangé : entrée décalée d'une bougie, 0,10 % de frais aller-retour,
walk-forward par année civile, et TÉMOIN ALÉATOIRE de même densité.

Usage : python backtest_4h.py
"""

import json
import os
import random
import time

import pandas as pd

import config
import binance_client

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "h4")
# Trois ans suffisent largement : à six bougies par jour, cela fait plus de
# 6 500 observations par paire, soit neuf fois la profondeur du backtest
# journalier sur la même période. La contrainte n'est pas la puissance
# statistique mais le temps de téléchargement.
JOURS = 1100
FEE_ROUND_TRIP_PCT = 0.10
N_PERMUTATIONS = 40


def charger_4h():
    """Bougies 4 heures des 40 paires, mises en cache au premier passage."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    out = {}
    for i, pair in enumerate(config.PAIRS, 1):
        symbole = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbole}_4h.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                candles = json.load(f)
        else:
            if i % 10 == 0:
                print(f"  ... {i}/{len(config.PAIRS)}", flush=True)
            try:
                candles = binance_client.get_historical_klines(symbole, interval="4h", days=JOURS)
            except Exception:
                continue
            if candles:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(candles, f)
            time.sleep(0.2)
        if not candles or len(candles) < 2000:
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "close", "volume"])
        df["ts"] = pd.to_datetime(df["ts_ms"], unit="ms")
        out[pair] = df.set_index("ts")[["open", "high", "low", "close", "volume"]].astype(float)
    return out


def rsi_frame(prix, periode):
    delta = prix.diff()
    gain = delta.clip(lower=0)
    perte = -delta.clip(upper=0)
    moy_gain = gain.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean()
    moy_perte = perte.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean()
    rs = moy_gain / moy_perte.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


def atr_frame(ohlcv, periode=14):
    out = {}
    for pair, df in ohlcv.items():
        prev = df["close"].shift(1)
        tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(),
                        (df["low"] - prev).abs()], axis=1).max(axis=1)
        out[pair] = tr.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean()
    return out


def collecter(prix, rang, ohlcv, atrs, n_top, hold_bougies, sl_atr=4.0,
              delay=1, filtre=None, aleatoire=None):
    """
    Achat des `n_top` paires les mieux classées, tenues `hold_bougies` bougies.

    `filtre` est une série booléenne indexée sur les bougies : le signal n'est
    émis que lorsqu'elle est vraie. `aleatoire` remplace la sélection par un
    tirage au sort de même densité — c'est le témoin.
    """
    rng = random.Random(aleatoire) if aleatoire is not None else None
    index = prix.index
    detenues = {}
    signaux = []

    for i in range(250, len(index) - hold_bougies - delay):
        for pair, echeance in list(detenues.items()):
            if i >= echeance:
                del detenues[pair]
        if filtre is not None and not bool(filtre.iloc[i]):
            continue

        classement = rang.iloc[i].dropna()
        classement = classement[classement.index[prix.iloc[i + delay][classement.index].notna()]]
        if len(classement) < 15:
            continue

        if rng is not None:
            dispo = [c for c in classement.index if c not in detenues]
            if len(dispo) < n_top:
                continue
            choix = rng.sample(dispo, n_top)
        else:
            choix = [p for p in classement.nlargest(n_top * 2).index if p not in detenues][:n_top]

        for pair in choix:
            if pair in detenues or pair not in atrs:
                continue
            entree = prix[pair].iloc[i + delay]
            valeur_atr = atrs[pair].iloc[i]
            if pd.isna(entree) or entree <= 0 or pd.isna(valeur_atr) or valeur_atr <= 0:
                continue
            detenues[pair] = i + delay + hold_bougies

            stop = entree - sl_atr * valeur_atr
            bougies = ohlcv[pair].reindex(index).iloc[i + delay + 1: i + delay + 1 + hold_bougies]
            sortie = None
            for _, bar in bougies.iterrows():
                if pd.isna(bar["low"]):
                    continue
                if bar["low"] <= stop:
                    sortie = stop
                    break
            if sortie is None:
                reste = bougies["close"].dropna()
                if reste.empty:
                    continue
                sortie = reste.iloc[-1]

            signaux.append({
                "pair": pair, "ts": index[i + delay],
                "gain_pct": (sortie - entree) / entree * 100 - FEE_ROUND_TRIP_PCT,
            })
    return pd.DataFrame(signaux)


def annees(t):
    lignes = [(y, t[t["ts"].dt.year == y]["gain_pct"]) for y in sorted(t["ts"].dt.year.unique())]
    lignes = [(y, s) for y, s in lignes if len(s) >= 20]
    return sum(1 for _, s in lignes if s.mean() > 0), len(lignes)


if __name__ == "__main__":
    print("Chargement des bougies 4 heures (téléchargement au premier passage)...", flush=True)
    ohlcv = charger_4h()
    if len(ohlcv) < 20:
        print(f"Seulement {len(ohlcv)} paires disponibles : données insuffisantes.")
        raise SystemExit(1)

    prix = pd.DataFrame({p: d["close"] for p, d in ohlcv.items()}).sort_index()
    n_bougies = len(prix)
    n_jours = n_bougies / 6
    print(f"{prix.shape[1]} paires, {n_bougies} bougies ({n_jours:.0f} jours, "
          f"{prix.index[0].date()} -> {prix.index[-1].date()})\n", flush=True)

    # Les paires n'ont pas toutes le même nombre de bougies : sans réalignement sur
    # l'index commun, un accès positionnel pointe sur la mauvaise date — ou sort de
    # la série pour les paires les plus courtes.
    atrs = {p: s.reindex(prix.index) for p, s in atr_frame(ohlcv).items()}
    # Le filtre de tendance reste celui du journalier — MM200 jours — évalué sur les
    # bougies 4 h : 200 jours = 1200 bougies. C'est la MÊME règle que les autres
    # familles, pour que la comparaison ait un sens.
    btc = prix["BTC/USDT"]
    ouvert = (btc > btc.rolling(1200).mean()).fillna(False)
    regime = ouvert
    jours_h = int(ouvert.sum()) / 6
    jours_b = (n_bougies - int(ouvert.sum())) / 6
    print(f"Filtre de tendance ouvert {100*ouvert.mean():.0f} % du temps\n")


    def rapport(t, label):
        if t.empty or len(t) < 60:
            print(f"  {label:<34} : trop peu de signaux ({0 if t.empty else len(t)})")
            return None
        g = t["gain_pct"]
        pos, tot = annees(t)
        masque = t["ts"].map(lambda x: bool(ouvert.get(x, False)))
        h, b = t[masque]["gain_pct"], t[~masque]["gain_pct"]
        fav = f"{h.mean():>+6.2f} %" if len(h) >= 30 else "     n/a"
        defav = f"{b.mean():>+6.2f} %" if len(b) >= 30 else "     n/a"
        print(f"  {label:<34} | {len(g)/n_jours:>5.2f}/j | {100*(g>0).mean():>5.1f} % | "
              f"{g.mean():>+6.2f} % | {pos}/{tot} | fav. {fav} | défav. {defav}")
        return t


    print("=== LE MOMENTUM TRANSVERSAL EN 4 HEURES, SANS FILTRE ===")
    print("Chaque bougie de 4 h est une occasion. La question est de savoir si le")
    print("classement garde un pouvoir prédictif à cet horizon.\n")
    print(f"  {'configuration':<34} | {'sig':>7} | {'gagn.':>6} | {'moy.':>7} | ann.+ | "
          f"{'FAVORABLE':>12} | {'DÉFAVORABLE':>14}")

    resultats = {}
    for periode in (14, 42):          # 14 bougies ≈ 2,3 j ; 42 ≈ 7 j
        rang = rsi_frame(prix, periode)
        for n_top in (5, 12):
            for hold in (6, 18, 42):  # 1 jour, 3 jours, 7 jours
                t = collecter(prix, rang, ohlcv, atrs, n_top, hold)
                r = rapport(t, f"RSI({periode}) top {n_top}, garde {hold//6} j")
                if r is not None:
                    resultats[(periode, n_top, hold)] = r

    if not resultats:
        print("\nAucune configuration exploitable.")
        raise SystemExit(0)

    cle = max(resultats, key=lambda k: resultats[k]["gain_pct"].mean())
    best = resultats[cle]
    periode, n_top, hold = cle
    print(f"\nMeilleure : RSI({periode}), top {n_top}, garde {hold//6} jour(s)")

    print("\n=== LA MÊME, AVEC LE FILTRE DE TENDANCE ===")
    rang = rsi_frame(prix, periode)
    rapport(collecter(prix, rang, ohlcv, atrs, n_top, hold, filtre=ouvert), "avec filtre MM200")

    print(f"\n=== TÉMOIN ALÉATOIRE ({N_PERMUTATIONS} tirages de même densité) ===")
    tirages = []
    for graine in range(N_PERMUTATIONS):
        t = collecter(prix, rang, ohlcv, atrs, n_top, hold, aleatoire=graine)
        if not t.empty and len(t) >= 60:
            tirages.append(t["gain_pct"].mean())
    if tirages:
        reel = best["gain_pct"].mean()
        mieux = sum(1 for v in tirages if v >= reel)
        p = mieux / len(tirages)
        print(f"  réelle {reel:+.2f} % | hasard {sum(tirages)/len(tirages):+.2f} % | "
              f"{mieux}/{len(tirages)} font mieux -> p = {p:.3f}")
        print(f"  {'>>> BAT LE HASARD' if p < 0.05 else 'indiscernable du hasard'}")

    print("\n=== ANNÉE PAR ANNÉE ===")
    for y in sorted(best["ts"].dt.year.unique()):
        s = best[best["ts"].dt.year == y]["gain_pct"]
        if len(s) < 20:
            continue
        print(f"  {y} : {len(s):>5} signaux | {100*(s>0).mean():>5.1f} % gagnants | {s.mean():>+6.2f} %")
