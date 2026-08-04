"""
Quatre familles de signaux indépendantes, testées au même protocole.

Pourquoi changer d'approche. Jusqu'ici le projet a cherché UNE stratégie qu'on
pousserait à fond. C'est une impasse arithmétique pour un canal qui vise 2 à 6
signaux par jour : avec 40 paires tenues 7 jours, le plafond absolu est de
5,7 entrées par jour même en prenant l'univers entier — et prendre l'univers
entier, c'est ne plus sélectionner. La qualité s'effondre bien avant.

La réponse est un PORTEFEUILLE de familles décorrélées. Quatre familles à
1-2 signaux par jour chacune donnent le compte, et la diversification améliore
la courbe au lieu de la dégrader. Surtout, certaines familles vivent quand le
momentum meurt — ce qui attaque directement le trou des 41 % de fermeture.

Les quatre familles testées ici, choisies pour être vraiment différentes :

  A. CASSURE DE CANAL (Donchian). Momentum TEMPOREL, pas transversal : on
     n'achète pas « la plus forte parmi 40 » mais « celle qui casse son plus
     haut de N jours ». Le signal est indépendant du classement, donc les deux
     familles ne se déclenchent pas aux mêmes moments.

  B. CASSURE DE CANAL À LA BAISSE. La même règle dans l'autre sens. Elle ne se
     déclenche que quand des paires cassent leurs plus bas, c'est-à-dire
     précisément pendant les marchés baissiers où la famille momentum se tait.

  C. REBOND DE CAPITULATION. Achat après une chute violente accompagnée d'un
     volume anormal. C'est du RETOUR À LA MOYENNE — le contraire exact du
     momentum, donc décorrélé par construction. Les capitulations se produisent
     surtout en marché baissier, là encore où le reste ne produit rien.

  D. EXPANSION DE VOLATILITÉ. Achat quand la volatilité, longtemps comprimée,
     se réveille à la hausse. Le moteur Squeeze du projet reposait sur cette
     idée mais n'a jamais été validé au protocole complet.

PROTOCOLE, identique pour les quatre et identique à celui qui a réfuté ~35
pistes : bougies journalières 2020-2026, entrée décalée d'un jour, 0,10 % de
frais aller-retour, stop et sortie temporelle, walk-forward par année civile,
et surtout TÉMOIN ALÉATOIRE — une famille qui ne bat pas un tirage au sort à
contraintes égales ne vaut rien, quelle que soit son espérance affichée.

Usage : python backtest_familles.py
"""

import json
import os
import random

import pandas as pd

import config
import binance_client

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "long_daily")
START = "2020-08-11"
FEE_ROUND_TRIP_PCT = 0.10
N_PERMUTATIONS = 60


def charger_ohlcv():
    """Bougies journalières complètes, volume compris, depuis le cache."""
    out = {}
    for pair in config.PAIRS:
        symbole = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbole}_1d.json")
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            candles = json.load(f)
        if not candles or len(candles) < 400:
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "close", "volume"])
        df["date"] = pd.to_datetime(df["ts_ms"], unit="ms").dt.normalize()
        out[pair] = df.set_index("date")[["open", "high", "low", "close", "volume"]].astype(float)
    return out


def atr(df, period=14):
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(),
                    (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


# --------------------------------------------------------------------------
# Les quatre détecteurs. Chacun rend une série booléenne : True le jour où le
# signal se déclenche. Aucun ne regarde le futur — tout est calculé sur des
# valeurs closes à l'index courant, et l'entrée se fera au jour suivant.
# --------------------------------------------------------------------------

def famille_cassure_haut(df, fenetre=50):
    """Clôture au-dessus du plus haut des `fenetre` jours PRÉCÉDENTS."""
    plus_haut = df["high"].shift(1).rolling(fenetre).max()
    return (df["close"] > plus_haut) & (df["close"].shift(1) <= plus_haut.shift(1))


def famille_cassure_bas(df, fenetre=50):
    """Clôture sous le plus bas des `fenetre` jours précédents : signal de VENTE."""
    plus_bas = df["low"].shift(1).rolling(fenetre).min()
    return (df["close"] < plus_bas) & (df["close"].shift(1) >= plus_bas.shift(1))


def famille_capitulation(df, chute_sigma=2.5, volume_mult=2.0):
    """
    Chute d'au moins `chute_sigma` écarts-types sur la journée, avec un volume
    d'au moins `volume_mult` fois sa moyenne 20 jours. On achète le rebond.
    """
    rend = df["close"].pct_change()
    sigma = rend.rolling(60).std()
    vol_moyen = df["volume"].rolling(20).mean()
    return (rend < -chute_sigma * sigma) & (df["volume"] > volume_mult * vol_moyen)


def famille_expansion_volatilite(df, compression=20, seuil=0.5):
    """
    L'amplitude vraie, longtemps comprimée, se réveille à la hausse : l'ATR
    court repasse au-dessus de l'ATR long après avoir été nettement en dessous,
    et la journée est haussière.
    """
    court, long_ = atr(df, 7), atr(df, 50)
    ratio = court / long_
    comprime = ratio.shift(1).rolling(compression).max() < (1 - seuil) + seuil
    reveil = (ratio > 1.0) & (ratio.shift(1) <= 1.0)
    return comprime & reveil & (df["close"] > df["open"])


FAMILLES = {
    "A. cassure de canal 50j (achat)": (famille_cassure_haut, "achat"),
    "B. cassure de canal 50j (vente)": (famille_cassure_bas, "vente"),
    "C. rebond de capitulation": (famille_capitulation, "achat"),
    "D. expansion de volatilité": (famille_expansion_volatilite, "achat"),
}


def evaluer(ohlcv, detecteur, sens, hold=7, sl_mult=4.0, delay=1, aleatoire=None):
    """
    Applique un détecteur à toutes les paires et rend la liste des trades.
    `aleatoire` remplace le détecteur par un tirage au sort de MÊME densité :
    c'est le témoin, et sans lui aucune conclusion n'est possible.
    """
    rng = random.Random(aleatoire) if aleatoire is not None else None
    trades = []
    for pair, df in ohlcv.items():
        df = df.loc[START:]
        if len(df) < 120:
            continue
        a = atr(df)
        declencheurs = detecteur(df).fillna(False)
        if rng is not None:
            # Même nombre de signaux, placés au hasard : la densité est donc
            # identique et seule la DATE de déclenchement change.
            n = int(declencheurs.sum())
            indices = rng.sample(range(60, len(df) - hold - delay), min(n, max(0, len(df) - hold - delay - 60)))
            declencheurs = pd.Series(False, index=df.index)
            declencheurs.iloc[indices] = True

        derniere_sortie = -1
        for i in range(60, len(df) - hold - delay):
            if not declencheurs.iloc[i] or i < derniere_sortie:
                continue
            entree = df["close"].iloc[i + delay]
            valeur_atr = a.iloc[i]
            if pd.isna(entree) or entree <= 0 or pd.isna(valeur_atr) or valeur_atr <= 0:
                continue
            derniere_sortie = i + delay + hold

            court = sens == "vente"
            stop = entree + sl_mult * valeur_atr if court else entree - sl_mult * valeur_atr
            bougies = df.iloc[i + delay + 1: i + delay + 1 + hold]
            sortie = None
            for _, b in bougies.iterrows():
                touche = b["high"] >= stop if court else b["low"] <= stop
                if touche:
                    sortie = stop
                    break
            if sortie is None:
                if bougies.empty:
                    continue
                sortie = bougies["close"].iloc[-1]

            brut = (entree - sortie) / entree if court else (sortie - entree) / entree
            trades.append({"pair": pair, "date": df.index[i + delay],
                           "gain_pct": brut * 100 - FEE_ROUND_TRIP_PCT})
    return pd.DataFrame(trades)


def resumer(t, label, n_jours, muet=False):
    if t.empty or len(t) < 40:
        if not muet:
            print(f"  {label:<34} : trop peu de signaux ({0 if t.empty else len(t)})")
        return None
    g = t["gain_pct"]
    annees = [(y, t[t["date"].dt.year == y]["gain_pct"]) for y in sorted(t["date"].dt.year.unique())]
    annees = [(y, s) for y, s in annees if len(s) >= 10]
    pos = sum(1 for _, s in annees if s.mean() > 0)
    r = {
        "n": len(g), "par_jour": len(g) / n_jours, "reussite": 100 * (g > 0).mean(),
        "esperance": g.mean(), "mediane": g.median(),
        "annees_pos": pos, "annees": len(annees), "trades": t,
    }
    if not muet:
        print(f"  {label:<34} | {r['par_jour']:>5.2f}/j | {r['reussite']:>5.1f} % | "
              f"{r['esperance']:>+6.2f} % | {r['mediane']:>+6.2f} % | {pos}/{len(annees)}")
    return r


if __name__ == "__main__":
    print("Chargement des bougies journalières...", flush=True)
    ohlcv = charger_ohlcv()
    n_jours = len(next(iter(ohlcv.values())).loc[START:])
    print(f"{len(ohlcv)} paires, {n_jours} jours à partir du {START}\n", flush=True)

    print("=== LES QUATRE FAMILLES, MÊME PROTOCOLE ===")
    print(f"  {'famille':<34} | {'signaux':>7} | {'réussite':>7} | {'moyenne':>8} | "
          f"{'médiane':>7} | années+")
    resultats = {}
    for nom, (detecteur, sens) in FAMILLES.items():
        r = resumer(evaluer(ohlcv, detecteur, sens), nom, n_jours)
        if r:
            resultats[nom] = (r, detecteur, sens)

    print("\n=== TÉMOIN ALÉATOIRE : chaque famille bat-elle un tirage de même densité ? ===")
    print("C'est le test qui a réfuté le momentum transversal (p = 0,885) et la vente")
    print("à découvert en marché baissier (p = 1,000). Rien ne passe sans lui.\n")
    retenues = {}
    for nom, (r, detecteur, sens) in resultats.items():
        tirages = []
        for graine in range(N_PERMUTATIONS):
            t = evaluer(ohlcv, detecteur, sens, aleatoire=graine)
            if not t.empty and len(t) >= 40:
                tirages.append(t["gain_pct"].mean())
        if not tirages:
            continue
        mieux = sum(1 for v in tirages if v >= r["esperance"])
        p = mieux / len(tirages)
        verdict = "RETENUE" if p < 0.05 and r["esperance"] > 0 else "rejetée"
        if verdict == "RETENUE":
            retenues[nom] = r
        print(f"  {nom:<34} | réelle {r['esperance']:>+6.2f} % | hasard {sum(tirages)/len(tirages):>+6.2f} % | "
              f"p = {p:.3f} | {verdict}")

    if not retenues:
        print("\nAucune famille ne passe le témoin aléatoire.")
        raise SystemExit(0)

    print("\n=== QUAND CHAQUE FAMILLE RETENUE SE DÉCLENCHE-T-ELLE ? ===")
    print("Une famille qui ne tire QUE pendant les hausses n'aide pas à combler le")
    print("trou des 41 %. C'est la répartition qui décide de l'intérêt, pas l'espérance.\n")
    btc = ohlcv["BTC/USDT"]["close"]
    mm200 = (btc > btc.rolling(200).mean())
    for nom, r in retenues.items():
        t = r["trades"]
        m = mm200.to_dict()
        en_hausse = t["date"].map(lambda d: bool(m.get(d, False)))
        n_h, n_b = int(en_hausse.sum()), int((~en_hausse).sum())
        esp_h = t[en_hausse]["gain_pct"].mean() if n_h else float("nan")
        esp_b = t[~en_hausse]["gain_pct"].mean() if n_b else float("nan")
        print(f"  {nom}")
        print(f"    marché HAUSSIER : {n_h:>4} signaux ({100*n_h/len(t):>3.0f} %) | espérance {esp_h:>+6.2f} %")
        print(f"    marché BAISSIER : {n_b:>4} signaux ({100*n_b/len(t):>3.0f} %) | espérance {esp_b:>+6.2f} %")

    print("\n=== PORTEFEUILLE : LES FAMILLES RETENUES RÉUNIES ===")
    tout = pd.concat([r["trades"] for r in retenues.values()], ignore_index=True)
    g = tout["gain_pct"]
    par_jour = len(g) / n_jours
    jours_actifs = tout["date"].nunique()
    print(f"  {len(g)} signaux au total, soit {par_jour:.2f} par jour en moyenne")
    print(f"  {jours_actifs} jours sur {n_jours} avec au moins un signal ({100*jours_actifs/n_jours:.0f} %)")
    print(f"  Réussite {100*(g>0).mean():.1f} % | moyenne {g.mean():+.2f} % | médiane {g.median():+.2f} %")
    annees = [(y, tout[tout["date"].dt.year == y]["gain_pct"]) for y in sorted(tout["date"].dt.year.unique())]
    for y, s in annees:
        if len(s) >= 10:
            print(f"    {y} : {len(s):>4} signaux | réussite {100*(s>0).mean():>4.1f} % | espérance {s.mean():>+6.2f} %")
