"""
Combien de signaux un abonné reçoit-il réellement par jour ?

POURQUOI CE SCRIPT EXISTE. Le produit publie « 4,35 signaux par jour en marché
favorable, 1,15 en marché défavorable » à une vingtaine d'endroits — site,
/help, /subscribe, /trial, /demo, /marche, /status. Ce chiffre a été mesuré à
une époque où DEUX moteurs émettaient : la force relative et le carry.

Il y en a cinq aujourd'hui. La cassure de canal et l'expansion de volatilité
ont été ajoutées après cette mesure, et elles émettent dans le même régime que
la force relative. Le chiffre publié ne décrit donc plus le produit.

CE QUI EST MESURÉ. Le nombre de signaux réellement DÉLIVRÉS, c'est-à-dire après
l'arbitre : les candidats directionnels sont plafonnés à QUOTA_SIGNAUX_MAX par
jour, les carrys ont leur propre plafond et ne concourent pas pour ces places.

LA DÉTENTION EST SIMULÉE, et c'est le point qui décide du résultat. En
production, un moteur ne resignale pas une paire qu'il détient déjà
(`already_open`). Sans cette simulation, la force relative proposerait ses
douze premières paires chaque jour, le plafond mordrait tous les jours, et le
chiffre obtenu serait le plafond lui-même — pas une mesure.

CE QUI N'EST PAS SIMULÉ, et pourquoi le résultat reste une borne basse :
  - Le carry (il demande l'historique des taux de financement, pas des
    bougies). On réutilise son rythme déjà mesuré.
  - Le momentum 4H : il ne travaille qu'en régime défavorable et demande des
    bougies 4 h sur six ans.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import config
from cassure_expansion import cassure_aujourdhui, expansion_aujourdhui
from relative_strength import rank_pairs
from signal_arbiter import plafond_du_moteur, esperance_par_jour
from backtest_familles import charger_ohlcv

# Rythme du carry déjà mesuré ailleurs (voir carry_engine.py), réutilisé tel
# quel : il est neutre au marché, donc identique dans les deux régimes.
CARRY_PAR_JOUR_MESURE = 1.15

# Les trois moteurs directionnels et leur durée de détention, celle qui a été
# validée en backtest. Tous trois utilisent la même en production (main.py
# appelle pairs_signalled_by_engine avec RS_HOLD_DAYS * 24 pour les deux
# nouveaux).
DUREE_DETENTION = config.RS_HOLD_DAYS

# Minimum de paires disponibles pour qu'une date compte : sans ce seuil, les
# premières années — où le cache ne contient que quelques paires — feraient
# baisser artificiellement le débit mesuré.
MIN_PAIRES = 20


def arbitrer(candidats: list) -> list:
    """
    Reproduit la sélection de signal_arbiter.appliquer_quota pour les seuls
    directionnels : une place garantie à chaque moteur qui a quelque chose à
    dire, puis le reste au mérite, dans la limite du plafond global.
    """
    classes = sorted(candidats, key=lambda c: -esperance_par_jour(c[0]))
    retenus, par_moteur, deja_servi = [], {}, set()

    def peut_prendre(c):
        return len(retenus) < config.QUOTA_SIGNAUX_MAX and par_moteur.get(c[0], 0) < plafond_du_moteur(c[0])

    for c in classes:
        if c[0] in deja_servi or not peut_prendre(c):
            continue
        deja_servi.add(c[0])
        par_moteur[c[0]] = par_moteur.get(c[0], 0) + 1
        retenus.append(c)

    for c in classes:
        if c in retenus or not peut_prendre(c):
            continue
        par_moteur[c[0]] = par_moteur.get(c[0], 0) + 1
        retenus.append(c)

    return retenus


def main() -> int:
    ohlcv = charger_ohlcv()
    if "BTC/USDT" not in ohlcv:
        print("BTC/USDT absent du cache : mesure impossible.")
        return 1

    btc = ohlcv["BTC/USDT"]
    filtre_ouvert = (btc["close"] > btc["close"].rolling(config.RS_TREND_MA_PERIOD).mean()).dropna()

    dates = [d for d in filtre_ouvert.index if sum(1 for df in ohlcv.values() if d in df.index) >= MIN_PAIRES]
    if not dates:
        print("Aucune date exploitable.")
        return 1

    # (moteur, paire) -> date de libération. C'est ce registre qui rend la
    # mesure honnête : sans lui, on mesurerait le plafond, pas le débit.
    detenues: dict = {}

    jours_ouverts = jours_fermes = 0
    delivres_ouverts = candidats_ouverts = 0
    jours_plafonnes = 0
    jours_avec_directionnel = 0
    par_moteur_total: dict = {}

    for d in dates:
        for cle, fin in list(detenues.items()):
            if d >= fin:
                del detenues[cle]

        if not bool(filtre_ouvert.loc[d]):
            # Les trois directionnels se taisent. Le carry et le momentum 4H
            # prennent le relais ; ni l'un ni l'autre n'est simulé ici.
            jours_fermes += 1
            continue

        jours_ouverts += 1
        tranche = {p: df.loc[:d] for p, df in ohlcv.items() if d in df.index and len(df.loc[:d]) >= 220}
        if not tranche:
            continue

        candidats = []
        try:
            for pair, _ in rank_pairs(tranche)[: config.RS_TOP_N]:
                if ("relative_strength", pair) not in detenues:
                    candidats.append(("relative_strength", pair))
        except Exception:
            pass

        for pair, df in tranche.items():
            try:
                if cassure_aujourdhui(df) and ("cassure_canal", pair) not in detenues:
                    candidats.append(("cassure_canal", pair))
                if expansion_aujourdhui(df) and ("expansion_volatilite", pair) not in detenues:
                    candidats.append(("expansion_volatilite", pair))
            except Exception:
                continue

        candidats_ouverts += len(candidats)
        retenus = arbitrer(candidats)
        if len(candidats) > len(retenus):
            jours_plafonnes += 1

        for cle in retenus:
            detenues[cle] = d + __import__("pandas").Timedelta(days=DUREE_DETENTION)
            par_moteur_total[cle[0]] = par_moteur_total.get(cle[0], 0) + 1

        delivres_ouverts += len(retenus)
        if retenus:
            jours_avec_directionnel += 1

    total_jours = len(dates)
    print(f"Jours mesurés : {total_jours} ({dates[0].date()} → {dates[-1].date()})")
    print(f"  filtre ouvert : {jours_ouverts} ({100 * jours_ouverts / total_jours:.1f} %)")
    print(f"  filtre fermé  : {jours_fermes} ({100 * jours_fermes / total_jours:.1f} %)")
    print()

    if jours_ouverts:
        dir_par_jour = delivres_ouverts / jours_ouverts
        print("MARCHÉ FAVORABLE")
        print(f"  candidats directionnels proposés : {candidats_ouverts / jours_ouverts:.2f} / jour")
        print(f"  directionnels délivrés           : {dir_par_jour:.2f} / jour")
        print(f"  + carry (mesuré ailleurs)        : {CARRY_PAR_JOUR_MESURE:.2f} / jour")
        print(f"  TOTAL REÇU                       : {dir_par_jour + CARRY_PAR_JOUR_MESURE:.2f} / jour")
        print(f"  jours où le plafond a mordu      : {jours_plafonnes} ({100 * jours_plafonnes / jours_ouverts:.1f} %)")
        print(f"  jours avec >= 1 directionnel     : {jours_avec_directionnel} "
              f"({100 * jours_avec_directionnel / jours_ouverts:.1f} %)")
        print("  répartition des directionnels :")
        for moteur, n in sorted(par_moteur_total.items(), key=lambda kv: -kv[1]):
            print(f"    {moteur:24s} {n:5d}  ({n / jours_ouverts:.2f}/jour)")

    print()
    print("MARCHÉ DÉFAVORABLE")
    print(f"  directionnels : 0 / jour (filtre fermé, par construction)")
    print(f"  carry seul    : {CARRY_PAR_JOUR_MESURE:.2f} / jour (hors momentum 4H, non simulé)")

    if jours_ouverts:
        total = delivres_ouverts + CARRY_PAR_JOUR_MESURE * total_jours
        print(f"\nToutes périodes confondues : {total / total_jours:.2f} signaux par jour")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
