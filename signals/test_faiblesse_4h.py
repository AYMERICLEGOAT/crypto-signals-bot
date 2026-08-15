"""
Vérification du moteur Faiblesse 4H, sans pytest (convention du dépôt).

Trois propriétés dont une erreur ne ferait RIEN planter — elle produirait
simplement des signaux faux, envoyés à des abonnés :

  - LE SENS. Ce moteur vend les plus FAIBLES. S'il classait à l'endroit, il
    vendrait les plus fortes : la stratégie exactement inversée, avec les
    mêmes messages et le même air de fonctionner.
  - LE RÉGIME. Il ne doit émettre QUE quand le Bitcoin est sous sa moyenne
    200 jours. Vendre à découvert dans un marché porteur, c'est parier contre
    la dérive — l'erreur symétrique de celle que le filtre évite à l'achat.
  - LA GÉOMÉTRIE. Le stop d'une vente est AU-DESSUS de l'entrée. Un stop placé
    en dessous serait touché immédiatement à la première baisse, c'est-à-dire
    au moment précis où le trade fonctionne.

Usage : python test_faiblesse_4h.py
"""

from datetime import datetime, timezone

import numpy as np
import pandas as pd

import config
import faiblesse_4h as f4h

echecs = []


def verifier(condition, libelle):
    print(("  OK   " if condition else "  ECHEC ") + libelle)
    if not condition:
        echecs.append(libelle)


def bougies(prix_final, tendance, n=400):
    """
    Série 4 h synthétique terminant à `prix_final`.

    `tendance` est la VARIATION TOTALE sur la série : positive = la série
    monte, négative = elle baisse. Le premier jet de ce fichier avait le signe
    à l'envers et fabriquait une « série baissière » qui montait — les trois
    vérifications de régime échouaient alors que le moteur était juste.
    """
    base = np.linspace(prix_final - tendance, prix_final, n)
    bruit = np.sin(np.arange(n) / 7.0) * abs(prix_final) * 0.004
    close = base + bruit
    return pd.DataFrame({
        "close": close,
        "high": close * 1.01,
        "low": close * 0.99,
        "open": close,
    })


print("=" * 60)
print("MOTEUR FAIBLESSE 4H")
print("=" * 60)

# BTC nettement sous sa moyenne 200 jours -> régime défavorable.
btc_baissier = bougies(50_000, -40_000, n=config.RS_TREND_MA_PERIOD * f4h.BOUGIES_PAR_JOUR + 50)
btc_haussier = bougies(90_000, 40_000, n=config.RS_TREND_MA_PERIOD * f4h.BOUGIES_PAR_JOUR + 50)

univers = {
    "FAIBLE1/USDT": bougies(10.0, -6.0),    # forte baisse -> RSI bas
    "FAIBLE2/USDT": bougies(20.0, -10.0),
    "MOYEN/USDT": bougies(30.0, 0.3),
    "FORT/USDT": bougies(40.0, 12.0),       # forte hausse -> RSI haut
}
# Le classement exige un nombre minimal de paires : on complète avec des
# séries neutres, qui ne doivent jamais sortir en tête.
for i in range(config.F4H_MIN_RANKED_PAIRS + 2):
    univers[f"NEUTRE{i}/USDT"] = bougies(5.0 + i, 0.1)
univers["BTC/USDT"] = btc_baissier

print("\n--- Le sens du classement ---")
classement = f4h.classer_faibles(univers)
premiers = [p for p, _ in classement[:3]]
verifier(classement[0][1] <= classement[-1][1],
         "le classement va du plus FAIBLE au plus fort")
verifier("FORT/USDT" not in premiers,
         "la paire la plus FORTE n'est jamais en tete du classement des faibles")

print("\n--- Le regime ---")
signaux_baissier = f4h.detect_faiblesse_4h_signals(univers, btc_baissier)
verifier(len(signaux_baissier) > 0, "emet en marche defavorable")

univers_haussier = dict(univers)
univers_haussier["BTC/USDT"] = btc_haussier
verifier(f4h.detect_faiblesse_4h_signals(univers_haussier, btc_haussier) == [],
         "se TAIT en marche favorable (ne parie pas contre la derive)")
verifier(f4h.detect_faiblesse_4h_signals(univers, None) == [],
         "se tait quand le regime est indeterminable, au lieu de deviner")

print("\n--- La geometrie d'une vente ---")
s = signaux_baissier[0]
verifier(s["type"] == "SELL", "le type est SELL")
verifier(s["stop_loss"] > s["entry_price"],
         "le stop est AU-DESSUS de l'entree (une vente perd quand ca monte)")
verifier(s["tp1_price"] < s["entry_price"], "TP1 est EN DESSOUS de l'entree")
verifier(s["tp3_price"] < s["tp2_price"] < s["tp1_price"],
         "les objectifs descendent : TP3 < TP2 < TP1")
verifier(s["engine"] == "faiblesse_4h", "le moteur est nomme")
verifier(all(v > 0 for v in (s["entry_price"], s["stop_loss"], s["tp1_price"], s["tp3_price"])),
         "aucun niveau negatif ou nul, meme sur un actif tres volatil")

print("\n--- Les bornes ---")
verifier(len(signaux_baissier) <= config.F4H_TOP_N,
         f"jamais plus de {config.F4H_TOP_N} ventes par passage")
deja = {p for p, _ in classement[: config.F4H_TOP_N]}
verifier(all(x["pair"] not in deja
             for x in f4h.detect_faiblesse_4h_signals(univers, btc_baissier, already_open=deja)),
         "une paire deja en position n'est jamais revendue")

echeance = datetime.fromisoformat(s["hold_until"])
creation = datetime.fromisoformat(s["created_at"])
verifier(abs((echeance - creation).total_seconds() / 3600 - config.F4H_HOLD_BOUGIES * 4) < 1,
         f"l'echeance vaut bien {config.F4H_HOLD_BOUGIES * 4} h apres l'emission")

print("\n" + "=" * 60)
if echecs:
    print(f"{len(echecs)} verification(s) en echec :")
    for e in echecs:
        print("  -", e)
    raise SystemExit(1)
print("Toutes les verifications passent.")
