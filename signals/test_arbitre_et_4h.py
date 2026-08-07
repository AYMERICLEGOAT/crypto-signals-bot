"""
Vérification de l'arbitre et du moteur 4 heures, sans pytest.

Deux mécanismes dont une erreur passerait totalement inaperçue en production :

  - l'ARBITRE compare des moteurs dont les espérances ne sont PAS dans la même
    unité. Une erreur de normalisation ne ferait rien planter : elle
    classerait simplement les moteurs dans le mauvais ordre, et on
    privilégierait silencieusement le moins bon pendant des mois.
  - le MOTEUR 4H ne doit travailler QUE quand le marché est défavorable. S'il
    se déclenchait aussi en marché favorable, il émettrait dans le seul régime
    où sa mesure est NÉGATIVE (-0,14 %), tout en paraissant fonctionner.

Les deux sont vérifiés explicitement.

Usage : python test_arbitre_et_4h.py
"""

from datetime import datetime, timezone

import numpy as np
import pandas as pd

import config
import signal_arbiter as arb
import momentum_4h as m4h

echecs = []


def verifie(condition, message):
    if condition:
        print(f"  OK   {message}")
    else:
        print(f"  ECHEC {message}")
        echecs.append(message)


def bougies(n, depart=100.0, pente=0.0, bruit=0.0, graine=0):
    """Bougies 4 h synthétiques : tendance linéaire plus bruit reproductible."""
    rng = np.random.default_rng(graine)
    closes = np.maximum(depart + pente * np.arange(n) + rng.normal(0, bruit, n), 0.01)
    return pd.DataFrame({"open": closes, "high": closes * 1.02,
                         "low": closes * 0.98, "close": closes})


def sig(engine, pair="X/USDT"):
    return ({"pair": pair, "engine": engine, "type": "BUY"}, None)


print("\n=== 1. L'unité commune de l'arbitre ===")
# C'est le cœur du système : +3,22 % sur 7 jours et +0,572 % sur 21 jours ne
# se comparent pas tels quels. Ramenés au jour de capital immobilisé, le
# classement change complètement.
verifie(abs(arb.esperance_par_jour("relative_strength") - 3.22 / 7) < 1e-9,
        "force relative : +3,22 % sur 7 jours -> 0,460 %/jour")
verifie(abs(arb.esperance_par_jour("carry_funding") - 0.572 / 21) < 1e-9,
        "carry : +0,572 % sur 21 jours -> 0,027 %/jour")
verifie(abs(arb.esperance_par_jour("momentum_4h") - 0.805 / 3) < 1e-9,
        "momentum 4h : +0,805 % sur 3 jours -> 0,268 %/jour (mesure du top 2, celle qui est publiée)")
verifie(arb.esperance_par_jour("relative_strength") > arb.esperance_par_jour("momentum_4h")
        > arb.esperance_par_jour("carry_funding"),
        "l'ordre est force relative > momentum 4h > carry, et non l'ordre des chiffres bruts")
verifie(arb.esperance_par_jour("moteur_inconnu") == 0.0,
        "un moteur sans profil rend 0 : jamais préféré à un moteur mesuré, mais pas rejeté")

print("\n=== 2. Le plafond quotidien ===")
beaucoup = [sig("relative_strength", f"P{i}/USDT") for i in range(12)]
retenus, ecartes = arb.arbitrer(beaucoup)
verifie(len(retenus) == config.QUOTA_SIGNAUX_MAX,
        f"jamais plus de QUOTA_SIGNAUX_MAX = {config.QUOTA_SIGNAUX_MAX} signaux par jour")
verifie(len(ecartes) == 12 - config.QUOTA_SIGNAUX_MAX,
        "les candidats en trop sont écartés, et comptés")

print("\n=== 3. Le classement départage réellement ===")
melange = [sig("carry_funding", "CARRY/USDT"), sig("momentum_4h", "M4H/USDT"),
           sig("relative_strength", "RS/USDT")]
retenus, _ = arb.arbitrer(melange)
ordre = [c[0]["pair"] for c in retenus]
verifie(ordre[0] == "RS/USDT",
        "la force relative passe en tête : meilleure espérance par jour de capital")
verifie(ordre.index("M4H/USDT") < ordre.index("CARRY/USDT"),
        "le momentum 4h passe devant le carry, malgré des espérances brutes proches")

print("\n=== 4. Le plancher n'invente RIEN ===")
# La règle la plus importante : un plancher qui forcerait l'émission
# conduirait à diffuser les moins bons candidats du jour, c'est-à-dire
# exactement ceux que la mesure dit perdants.
un_seul = [sig("relative_strength")]
retenus, _ = arb.arbitrer(un_seul)
verifie(len(retenus) == 1,
        f"un seul candidat reste un seul signal, sous l'objectif de {config.QUOTA_SIGNAUX_MIN}")
verifie(arb.arbitrer([]) == ([], []),
        "aucun candidat -> aucun signal, jamais de remplissage")

print("\n=== 5. Les moteurs désactivés ne prennent pas de place ===")
melange = [sig("high_confidence", "VIEUX/USDT"), sig("relative_strength", "BON/USDT")]
retenus, ecartes = arb.arbitrer(melange)
verifie([c[0]["pair"] for c in retenus] == ["BON/USDT"],
        "un signal d'un moteur à espérance nulle est écarté même s'il reste de la place")
verifie(any(c[0]["pair"] == "VIEUX/USDT" for c in ecartes),
        "et il apparaît bien dans les écartés, pas dans le néant")

print("\n=== 6. Le moteur 4h ne travaille QUE en marché défavorable ===")
besoin = config.RS_TREND_MA_PERIOD * m4h.BOUGIES_PAR_JOUR + 50
btc_baisse = bougies(besoin, depart=400, pente=-0.05, bruit=1, graine=1)
btc_hausse = bougies(besoin, depart=100, pente=0.05, bruit=1, graine=2)
btc_court = bougies(100, pente=0.05)

verifie(m4h.marche_defavorable(btc_baisse) is True, "sous la moyenne 200 jours -> défavorable")
verifie(m4h.marche_defavorable(btc_hausse) is False, "au-dessus -> favorable")
verifie(m4h.marche_defavorable(btc_court) is None,
        "historique trop court -> None, et non une supposition")

univers = {f"P{i}/USDT": bougies(400, pente=0.5 - i * 0.02, graine=i) for i in range(20)}
verifie(m4h.detect_momentum_4h_signals(univers, btc_hausse) == [],
        "marché FAVORABLE -> aucun signal : c'est le seul régime où sa mesure est négative")
verifie(m4h.detect_momentum_4h_signals(univers, btc_court) == [],
        "régime indéterminable -> aucun signal, refus par défaut")

print("\n=== 7. Le sens du classement en 4h ===")
univers_signe = {
    "FORTE/USDT": bougies(400, depart=100, pente=1.0, bruit=0.3, graine=10),
    "FAIBLE/USDT": bougies(400, depart=600, pente=-0.8, bruit=0.3, graine=11),
}
for i in range(18):
    univers_signe[f"NEUTRE{i}/USDT"] = bougies(400, depart=100, pente=0.0, bruit=2.0, graine=100 + i)
noms = [p for p, _ in m4h.classer(univers_signe)]
verifie(noms[0] == "FORTE/USDT", "la paire la plus forte est classée PREMIÈRE")
verifie(noms[-1] == "FAIBLE/USDT", "la plus faible est classée DERNIÈRE")

signaux = m4h.detect_momentum_4h_signals(univers_signe, btc_baisse)
verifie(len(signaux) == config.M4H_TOP_N,
        f"exactement M4H_TOP_N = {config.M4H_TOP_N} signaux, le volume étant volontairement bridé")
verifie("FAIBLE/USDT" not in {s["pair"] for s in signaux},
        "aucun signal sur la paire la plus faible")

print("\n=== 8. Géométrie du signal 4h ===")
s = signaux[0]
verifie(s["type"] == "BUY", "le moteur n'émet que des achats")
verifie(s["engine"] == "momentum_4h", "moteur correctement étiqueté")
verifie(s["stop_loss"] < s["entry_price"] < s["tp1_price"] < s["tp2_price"] < s["tp3_price"],
        "stop sous l'entrée, objectifs croissants au-dessus")
verifie(s["stop_loss"] > 0, "stop strictement positif")
ouverture = datetime.fromisoformat(s["created_at"])
cloture = datetime.fromisoformat(s["hold_until"])
verifie(abs((cloture - ouverture).total_seconds() / 3600 - config.M4H_HOLD_BOUGIES * 4) < 1,
        f"clôture prévue {config.M4H_HOLD_BOUGIES * 4} heures après l'ouverture "
        f"({config.M4H_HOLD_BOUGIES // 6} jours, la durée mesurée)")

print("\n=== 9. Positions déjà ouvertes et données dégradées ===")
deja = {noms[0], noms[1]}
emises = {x["pair"] for x in m4h.detect_momentum_4h_signals(univers_signe, btc_baisse, already_open=deja)}
verifie(not (deja & emises), "une paire déjà en position n'est jamais rouverte")
verifie(m4h.detect_momentum_4h_signals({}, btc_baisse) == [],
        "aucune paire classable -> aucun signal")
troue = dict(univers_signe)
troue["VIDE/USDT"] = None
troue["COURT/USDT"] = bougies(5)
try:
    verifie(len(m4h.detect_momentum_4h_signals(troue, btc_baisse)) == config.M4H_TOP_N,
            "une paire vide ou trop courte est ignorée sans faire échouer le cycle")
except Exception as exc:  # noqa: BLE001
    verifie(False, f"exception sur données dégradées : {exc}")

print("\n=== 10. Le moteur en observation ne prend jamais la journée entière ===")
# Constaté en conditions réelles : le moteur 4h proposait 5 candidats et
# occupait les 5 places. Tous portent la même espérance, donc le classement
# seul ne peut PAS les départager — il fallait un plafond par moteur.
cinq_4h = [sig("momentum_4h", f"M{i}/USDT") for i in range(5)]
retenus, ecartes = arb.arbitrer(cinq_4h)
verifie(len(retenus) == config.QUOTA_OBSERVATION_MAX,
        f"5 candidats en observation -> {config.QUOTA_OBSERVATION_MAX} places seulement")
verifie(config.QUOTA_OBSERVATION_MAX < config.QUOTA_SIGNAUX_MAX,
        "un moteur en observation est minoritaire par construction, pas par chance")

# La place libérée doit revenir à un autre moteur, pas disparaître.
melange = [sig("momentum_4h", f"M{i}/USDT") for i in range(5)] + \
          [sig("relative_strength", f"R{i}/USDT") for i in range(3)]
retenus, _ = arb.arbitrer(melange)
moteurs = [c[0]["engine"] for c in retenus]
verifie(len(retenus) == config.QUOTA_SIGNAUX_MAX,
        "la journée reste pleine : le plafond redistribue, il ne tronque pas")
verifie(moteurs.count("momentum_4h") == config.QUOTA_OBSERVATION_MAX,
        "le moteur en observation garde exactement sa part")
verifie(moteurs.count("relative_strength") == 3,
        "les places rendues vont au moteur dont l'espérance est établie")
verifie(moteurs[0] == "relative_strength",
        "et le meilleur moteur reste en tête de liste")

verifie(len(arb.arbitrer([sig("relative_strength", f"R{i}/USDT") for i in range(9)])[0])
        == config.QUOTA_SIGNAUX_MAX,
        "un moteur ÉTABLI n'est bridé que par le plafond global, pas au-delà")

print("\n=== 11. Cohérence des constantes ===")
verifie(config.QUOTA_SIGNAUX_MIN < config.QUOTA_SIGNAUX_MAX, "plancher sous le plafond")
verifie(config.M4H_HOLD_BOUGIES % m4h.BOUGIES_PAR_JOUR == 0,
        "la durée de détention tombe sur un nombre entier de jours")
verifie(config.QUOTA_OBSERVATION_MAX >= 1,
        "un moteur en observation publie quand même : l'observer suppose de le voir tourner")

print("\n" + "=" * 60)
if echecs:
    print(f"{len(echecs)} VÉRIFICATION(S) EN ÉCHEC :")
    for e in echecs:
        print(f"  - {e}")
    raise SystemExit(1)
print("Toutes les vérifications passent.")
