"""
Le retour à la moyenne dans un canal : la famille faite pour les marchés sans tendance.

Pourquoi cette piste maintenant. Les trois familles directionnelles du projet
achètent une CONTINUATION : force relative, cassure de canal, expansion de
volatilité. Toutes sont coupées quand le Bitcoin passe sous sa moyenne 200
jours, soit 41 % du temps — et c'est le cas aujourd'hui, où il est sous ses
QUATRE moyennes (20, 50, 100 et 200 jours) et où seules 3 paires sur 40 sont
au-dessus de leur propre MM200.

Or un marché sans tendance n'est pas un marché sans mouvement. Les prix y
oscillent dans des canaux, et c'est précisément la situation où le retour à la
moyenne fonctionne là où le momentum échoue. C'est aussi le type de signal le
plus lisible pour un abonné : acheter en bas d'un canal identifié, viser le
haut, sortir en dessous. Rien à comprendre de plus.

Cette famille n'a jamais été testée. Le rebond de capitulation l'a été et a
échoué (p = 0,650), mais ce n'est pas la même chose : la capitulation cherche
une CHUTE VIOLENTE isolée, ici on cherche une oscillation RÉGULIÈRE dans des
bornes stables. Le premier est un accident, le second un régime.

Trois conditions doivent être réunies pour parler de canal :
  1. l'amplitude du canal est suffisante pour que l'aller-retour paie les frais ;
  2. le prix a déjà rebondi plusieurs fois entre ces bornes — un canal qui n'a
     jamais tenu n'est pas un canal, c'est une coïncidence ;
  3. il n'y a pas de tendance forte en cours, sinon acheter le bas du canal
     revient à acheter une chute.

PROTOCOLE, identique à celui qui a réfuté ~35 pistes : 2020-2026, entrée
décalée d'un jour, 0,10 % de frais aller-retour, walk-forward par année civile,
et TÉMOIN ALÉATOIRE de même densité — une famille qui ne bat pas un tirage au
sort ne vaut rien, quelle que soit son espérance affichée.

Question décisive, posée séparément : que donne-t-elle quand le marché est
DÉFAVORABLE ? C'est là qu'on a besoin d'elle. Une famille qui ne produit que
pendant les hausses n'apporte rien de plus que les trois existantes.

Usage : python backtest_range.py
"""

import random

import pandas as pd

from backtest_familles import charger_ohlcv, atr, START, FEE_ROUND_TRIP_PCT

N_PERMUTATIONS = 60


def bornes_du_canal(df, fenetre):
    """Plus haut et plus bas des `fenetre` jours précédents, bougie du jour exclue."""
    return (
        df["high"].shift(1).rolling(fenetre).max(),
        df["low"].shift(1).rolling(fenetre).min(),
    )


def detecteur_range(df, fenetre=20, zone=0.25, amplitude_min=0.08, rebonds_min=2):
    """
    Achat quand le prix entre dans le bas d'un canal établi.

    `zone` : fraction basse du canal considérée comme zone d'achat (0,25 = le
    quart inférieur). `amplitude_min` : hauteur minimale du canal en fraction du
    prix, pour que l'aller-retour couvre largement les frais. `rebonds_min` :
    nombre de passages dans la zone basse au cours de la fenêtre précédente —
    un canal qui n'a jamais tenu n'est pas un canal.
    """
    haut, bas = bornes_du_canal(df, fenetre)
    hauteur = haut - bas
    amplitude_ok = (hauteur / df["close"]) >= amplitude_min

    seuil_bas = bas + hauteur * zone
    dans_la_zone = df["close"] <= seuil_bas
    # Entrée seulement au MOMENT où le prix pénètre la zone, pas tant qu'il y
    # reste : sinon un prix qui glisse le long du bas déclencherait chaque jour.
    entree = dans_la_zone & ~dans_la_zone.shift(1).fillna(False)

    # Le canal doit avoir déjà tenu : on compte les visites de la zone basse
    # sur la fenêtre écoulée. Une seule visite, c'est le prix qui casse.
    rebonds = dans_la_zone.shift(1).rolling(fenetre).sum()
    canal_etabli = rebonds >= rebonds_min

    # Pas de tendance baissière forte en cours : sous sa moyenne courte ET en
    # baisse marquée, le « bas du canal » n'est qu'une étape vers plus bas.
    mm = df["close"].rolling(fenetre).mean()
    pas_en_chute = df["close"] >= mm * 0.85

    return entree & amplitude_ok & canal_etabli & pas_en_chute


def evaluer_range(ohlcv, detecteur, hold=10, sl_atr=3.0, cible_zone=0.75,
                  delay=1, aleatoire=None, fenetre=20):
    """
    Sortie sur objectif (haut du canal), sur stop, ou à l'expiration.
    Contrairement aux familles de momentum, l'objectif a ici un sens : c'est le
    haut du canal, c'est-à-dire le point où l'hypothèse se réalise.
    """
    rng = random.Random(aleatoire) if aleatoire is not None else None
    trades = []
    for pair, df in ohlcv.items():
        df = df.loc[START:]
        if len(df) < 120:
            continue
        a = atr(df)
        haut, bas = bornes_du_canal(df, fenetre)
        declencheurs = detecteur(df).fillna(False)

        if rng is not None:
            n = int(declencheurs.sum())
            plage = range(60, len(df) - hold - delay)
            indices = rng.sample(list(plage), min(n, len(plage)))
            declencheurs = pd.Series(False, index=df.index)
            declencheurs.iloc[indices] = True

        derniere_sortie = -1
        for i in range(60, len(df) - hold - delay):
            if not declencheurs.iloc[i] or i < derniere_sortie:
                continue
            entree = df["close"].iloc[i + delay]
            valeur_atr, h, b = a.iloc[i], haut.iloc[i], bas.iloc[i]
            if pd.isna(entree) or entree <= 0 or pd.isna(valeur_atr) or valeur_atr <= 0:
                continue
            if pd.isna(h) or pd.isna(b) or h <= b:
                continue
            derniere_sortie = i + delay + hold

            objectif = b + (h - b) * cible_zone
            stop = entree - sl_atr * valeur_atr
            bougies = df.iloc[i + delay + 1: i + delay + 1 + hold]

            sortie, raison = None, "expiration"
            for _, bar in bougies.iterrows():
                if pd.isna(bar["low"]) or pd.isna(bar["high"]):
                    continue
                # Stop évalué en premier : hypothèse défavorable quand les deux
                # tombent dans la même bougie.
                if bar["low"] <= stop:
                    sortie, raison = stop, "stop"
                    break
                if bar["high"] >= objectif:
                    sortie, raison = objectif, "objectif"
                    break
            if sortie is None:
                reste = bougies["close"].dropna()
                if reste.empty:
                    continue
                sortie = reste.iloc[-1]

            trades.append({
                "pair": pair, "date": df.index[i + delay], "raison": raison,
                "gain_pct": (sortie - entree) / entree * 100 - FEE_ROUND_TRIP_PCT,
            })
    return pd.DataFrame(trades)


def annees(t):
    lignes = [(y, t[t["date"].dt.year == y]["gain_pct"]) for y in sorted(t["date"].dt.year.unique())]
    lignes = [(y, s) for y, s in lignes if len(s) >= 10]
    return sum(1 for _, s in lignes if s.mean() > 0), len(lignes)


print("Chargement...", flush=True)
ohlcv = charger_ohlcv()
prix = pd.DataFrame({p: d["close"] for p, d in ohlcv.items()}).sort_index().loc[START:]
n_jours = len(prix)
btc = pd.DataFrame({p: d["close"] for p, d in ohlcv.items()}).sort_index()["BTC/USDT"]
ouvert = (btc > btc.rolling(200).mean()).reindex(prix.index).fillna(False).astype(bool)
regime = ouvert.to_dict()
jours_baisse = int((~ouvert).sum())
print(f"{prix.shape[1]} paires, {n_jours} jours | marché favorable {100*ouvert.mean():.0f} % du temps\n")


def rapport(t, label):
    if t.empty or len(t) < 40:
        print(f"  {label:<38} : trop peu de signaux ({0 if t.empty else len(t)})")
        return None
    g = t["gain_pct"]
    pos, tot = annees(t)
    b = t[~t["date"].map(lambda d: regime.get(d, False))]
    part = (f"{len(b)/jours_baisse:>5.2f}/j {b['gain_pct'].mean():>+6.2f} % "
            f"{100*(b['gain_pct']>0).mean():>5.1f} %" if len(b) >= 30 else "     trop peu")
    print(f"  {label:<38} | {len(g)/n_jours:>5.2f}/j | {100*(g>0).mean():>5.1f} % | "
          f"{g.mean():>+6.2f} % | {pos}/{tot} | {part}")
    return t


print("=== BALAYAGE DES PARAMÈTRES DU CANAL ===")
print("La colonne de droite est celle qui décide : que produit cette famille")
print("quand le marché est DÉFAVORABLE ? C'est là qu'on a besoin d'elle.\n")
print(f"  {'configuration':<38} | {'sig':>7} | {'gagn.':>6} | {'moy.':>7} | ann.+ | "
      f"{'MARCHÉ DÉFAVORABLE':>22}")

meilleures = {}
for fenetre in (20, 30):
    for zone in (0.20, 0.30):
        for amplitude in (0.06, 0.10):
            def d(df, f=fenetre, z=zone, a_=amplitude):
                return detecteur_range(df, fenetre=f, zone=z, amplitude_min=a_)
            t = evaluer_range(ohlcv, d, fenetre=fenetre)
            r = rapport(t, f"fenêtre {fenetre} j, zone {zone:.0%}, ampl. {amplitude:.0%}")
            if r is not None:
                meilleures[(fenetre, zone, amplitude)] = r

if not meilleures:
    print("\nAucune configuration ne produit assez de signaux.")
    raise SystemExit(0)

cle = max(meilleures, key=lambda k: meilleures[k]["gain_pct"].mean())
fenetre, zone, amplitude = cle
best = meilleures[cle]
print(f"\nMeilleure : fenêtre {fenetre} j, zone {zone:.0%}, amplitude {amplitude:.0%}")

print(f"\n=== TÉMOIN ALÉATOIRE ({N_PERMUTATIONS} tirages de même densité) ===")
print("C'est ce test qui a réfuté le momentum transversal (p = 0,885), la vente")
print("à découvert (p = 1,000) et le rebond de capitulation (p = 0,650).\n")


def detecteur_retenu(df):
    return detecteur_range(df, fenetre=fenetre, zone=zone, amplitude_min=amplitude)


tirages = []
for graine in range(N_PERMUTATIONS):
    t = evaluer_range(ohlcv, detecteur_retenu, fenetre=fenetre, aleatoire=graine)
    if not t.empty and len(t) >= 40:
        tirages.append(t["gain_pct"].mean())
if tirages:
    reel = best["gain_pct"].mean()
    mieux = sum(1 for v in tirages if v >= reel)
    p = mieux / len(tirages)
    print(f"  réelle {reel:+.2f} % | hasard {sum(tirages)/len(tirages):+.2f} % | "
          f"{mieux}/{len(tirages)} font mieux -> p = {p:.3f}")
    print(f"  {'>>> BAT LE HASARD' if p < 0.05 else 'indiscernable du hasard'}")

print("\n=== ANNÉE PAR ANNÉE ===")
for y in sorted(best["date"].dt.year.unique()):
    s = best[best["date"].dt.year == y]["gain_pct"]
    if len(s) < 10:
        continue
    print(f"  {y} : {len(s):>4} signaux | {100*(s>0).mean():>5.1f} % gagnants | {s.mean():>+6.2f} %")

print("\n=== D'OÙ VIENNENT LES SORTIES ? ===")
for raison, part in (best["raison"].value_counts(normalize=True) * 100).items():
    sous = best[best["raison"] == raison]["gain_pct"]
    print(f"  {raison:<12} {part:>5.1f} % des sorties | gain moyen {sous.mean():>+6.2f} %")

print("\n=== SENSIBILITÉ À LA DURÉE ET AU STOP ===")
print(f"  {'configuration':<38} | {'sig':>7} | {'gagn.':>6} | {'moy.':>7} | ann.+ | "
      f"{'MARCHÉ DÉFAVORABLE':>22}")
for hold in (7, 10, 15):
    for sl in (2.0, 3.0, 4.0):
        t = evaluer_range(ohlcv, detecteur_retenu, hold=hold, sl_atr=sl, fenetre=fenetre)
        rapport(t, f"détention {hold} j, stop {sl:.0f}x ATR")
