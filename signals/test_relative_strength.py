"""
Vérification du moteur Force Relative, sans pytest (assertions simples).

Ce moteur inverse le sens de tous les autres : il achète le RSI HAUT là où le
reste du projet achète le RSI bas. Une erreur de signe passerait totalement
inaperçue en production — les signaux partiraient, les messages seraient bien
formés, et la stratégie ferait exactement l'inverse de ce qui a été validé.
D'où une vérification explicite du sens, en plus des garde-fous habituels.

Usage : python test_relative_strength.py
"""

import numpy as np
import pandas as pd

import config
import relative_strength as rs

echecs = []


def verifie(condition, message):
    if condition:
        print(f"  OK   {message}")
    else:
        print(f"  ECHEC {message}")
        echecs.append(message)


def serie(n, depart=100.0, pente=0.0, bruit=0.0, graine=0):
    """Bougies journalières synthétiques : tendance linéaire + bruit reproductible."""
    rng = np.random.default_rng(graine)
    closes = depart + pente * np.arange(n) + rng.normal(0, bruit, n)
    closes = np.maximum(closes, 0.01)
    return pd.DataFrame({
        "open": closes,
        "high": closes * 1.02,
        "low": closes * 0.98,
        "close": closes,
    })


print("\n=== 1. Filtre de tendance absolue ===")
btc_hausse = serie(300, depart=100, pente=1.0, bruit=1.0, graine=1)
btc_baisse = serie(300, depart=400, pente=-1.0, bruit=1.0, graine=2)
btc_court = serie(50, pente=1.0)

verifie(rs.is_market_in_uptrend(btc_hausse) is True,
        "marché au-dessus de sa MM200 -> tendance haussière détectée")
verifie(rs.is_market_in_uptrend(btc_baisse) is False,
        "marché sous sa MM200 -> tendance baissière détectée")
verifie(rs.is_market_in_uptrend(btc_court) is None,
        "historique trop court -> None, et non une supposition")

print("\n=== 2. Aucun signal hors marché haussier ===")
univers = {f"P{i}/USDT": serie(300, pente=0.5 + i * 0.1, graine=i) for i in range(20)}
verifie(rs.detect_relative_strength_signals(univers, btc_baisse) == [],
        "marché baissier -> zéro signal (comportement qui a mis 2022 hors marché)")
verifie(rs.detect_relative_strength_signals(univers, btc_court) == [],
        "tendance indéterminable -> zéro signal, refus par défaut")
verifie(rs.detect_relative_strength_signals({"A/USDT": serie(300)}, btc_hausse) == [],
        "univers trop mince -> zéro signal (classement transversal impossible)")

print("\n=== 3. Le sens du classement : achète-t-on bien le RSI HAUT ? ===")
# Une paire en forte hausse a un RSI élevé, une paire en forte baisse un RSI bas.
univers_signe = {
    "FORTE/USDT": serie(300, depart=100, pente=2.0, bruit=0.5, graine=10),
    "FAIBLE/USDT": serie(300, depart=600, pente=-1.5, bruit=0.5, graine=11),
}
for i in range(18):  # de quoi atteindre RS_MIN_RANKED_PAIRS
    univers_signe[f"NEUTRE{i}/USDT"] = serie(300, depart=100, pente=0.0, bruit=2.0, graine=100 + i)

classement = rs.rank_pairs(univers_signe)
noms = [p for p, _ in classement]
verifie(noms[0] == "FORTE/USDT",
        "la paire en forte hausse est classée PREMIÈRE (RSI le plus haut)")
verifie(noms[-1] == "FAIBLE/USDT",
        "la paire en forte baisse est classée DERNIÈRE (RSI le plus bas)")

signaux = rs.detect_relative_strength_signals(univers_signe, btc_hausse)
emises = {s["pair"] for s in signaux}
verifie("FORTE/USDT" in emises,
        "signal émis sur la paire la plus forte")
verifie("FAIBLE/USDT" not in emises,
        "AUCUN signal sur la paire la plus faible — c'est le sens inverse des autres moteurs")

print("\n=== 4. Nombre de signaux et exclusion des positions ouvertes ===")
verifie(len(signaux) == config.RS_TOP_N,
        f"exactement RS_TOP_N = {config.RS_TOP_N} signaux quand rien n'est ouvert")

deja = {noms[0], noms[1]}
signaux_partiels = rs.detect_relative_strength_signals(univers_signe, btc_hausse, already_open=deja)
verifie(len(signaux_partiels) == config.RS_TOP_N - 2,
        "les paires déjà en position ne redéclenchent pas de signal")
verifie(not (deja & {s["pair"] for s in signaux_partiels}),
        "aucune paire déjà ouverte ne réapparaît dans les signaux")

print("\n=== 5. Géométrie du signal ===")
s = signaux[0]
verifie(s["type"] == "BUY", "le moteur n'émet que des achats")
verifie(s["engine"] == "relative_strength", "moteur correctement étiqueté")
verifie(s["stop_loss"] < s["entry_price"] < s["tp1_price"] < s["tp2_price"] < s["tp3_price"],
        "stop sous l'entrée, objectifs croissants au-dessus")
verifie(s["rs_hold_days"] == config.RS_HOLD_DAYS,
        f"durée de détention annoncée = {config.RS_HOLD_DAYS} jours (sortie temporelle)")
verifie(1 <= s["rs_rank"] <= config.RS_TOP_N, "rang cohérent")
verifie(s["stop_loss"] > 0, "stop strictement positif")

# Le rapport risque/gain doit refléter la géométrie mesurée : stop large,
# objectifs lointains. Un stop plus serré que l'objectif 1 signalerait un
# retour à l'ancienne géométrie, celle qui détruit l'avantage.
risque = s["entry_price"] - s["stop_loss"]
gain1 = s["tp1_price"] - s["entry_price"]
verifie(abs(risque - gain1) < risque * 0.01,
        "TP1 à la même distance que le stop (4 x ATR), conformément à la mesure")
verifie(s["tp3_price"] - s["entry_price"] > risque * 2.5,
        "TP3 nettement au-delà du risque : les gains viennent des grands mouvements")

print("\n=== 6. Robustesse aux données dégradées ===")
univers_troue = dict(univers_signe)
univers_troue["VIDE/USDT"] = None
univers_troue["COURT/USDT"] = serie(5)
try:
    sig = rs.detect_relative_strength_signals(univers_troue, btc_hausse)
    verifie(len(sig) == config.RS_TOP_N,
            "une paire vide ou trop courte est ignorée sans faire échouer le cycle")
except Exception as exc:  # noqa: BLE001 - on veut précisément savoir si ça casse
    verifie(False, f"exception sur données dégradées : {exc}")

plat = {f"P{i}/USDT": serie(300, pente=0.0, bruit=0.0, graine=i) for i in range(20)}
try:
    rs.detect_relative_strength_signals(plat, btc_hausse)
    verifie(True, "prix parfaitement plats (RSI indéfini) : aucune exception")
except Exception as exc:  # noqa: BLE001
    verifie(False, f"exception sur prix plats : {exc}")

print("\n" + "=" * 60)
if echecs:
    print(f"{len(echecs)} VÉRIFICATION(S) EN ÉCHEC :")
    for e in echecs:
        print(f"  - {e}")
    raise SystemExit(1)
print("Toutes les vérifications passent.")
