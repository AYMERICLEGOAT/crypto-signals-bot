"""
Vérification des deux moteurs journaliers ajoutés le 08/08/2026.

Ce qu'une erreur ici coûterait, et pourquoi elle passerait inaperçue : ces deux
détecteurs rendent un booléen. Une condition mal écrite ne fait rien planter —
elle produit simplement des signaux sur les mauvais jours, et le résultat ne se
voit qu'au bout de plusieurs semaines de trades perdants.

Les deux pièges classiques sont donc testés explicitement :
  - le plus haut doit être DÉCALÉ d'un jour, sinon la bougie du jour se compare
    à elle-même et la condition est toujours vraie ;
  - la cassure est un ÉVÉNEMENT, pas un état : une paire qui reste en zone haute
    ne doit pas redéclencher un signal chaque jour.

Usage : python test_cassure_expansion.py
"""

from datetime import datetime, timezone

import numpy as np
import pandas as pd

import config
import cassure_expansion as ce

echecs = []


def verifie(condition, message):
    if condition:
        print(f"  OK   {message}")
    else:
        print(f"  ECHEC {message}")
        echecs.append(message)


def bougies(closes, opens=None, marge=0.005):
    closes = np.asarray(closes, dtype=float)
    opens = np.asarray(opens, dtype=float) if opens is not None else closes * (1 - marge)
    return pd.DataFrame({
        "open": opens,
        "high": np.maximum(closes, opens) * (1 + marge),
        "low": np.minimum(closes, opens) * (1 - marge),
        "close": closes,
    })


def btc(favorable: bool):
    """Bitcoin nettement au-dessus (ou en dessous) de sa moyenne 200 jours."""
    n = config.RS_TREND_MA_PERIOD + 60
    pente = 0.5 if favorable else -0.5
    return bougies(100 + pente * np.arange(n) + 200)


print("\n=== 1. La cassure est un franchissement, pas un niveau ===")
# Palier plat à 100 pendant 60 jours, puis une clôture à 110 : c'est une cassure.
plat = [100.0] * 60
verifie(ce.cassure_aujourdhui(bougies(plat + [110.0])) is True,
        "clôture au-dessus du plus haut des 50 jours -> cassure détectée")

# Le lendemain, le prix reste haut : ce n'est PLUS une cassure. Sans cette
# règle, une paire en zone haute redéclencherait un signal tous les jours.
verifie(ce.cassure_aujourdhui(bougies(plat + [110.0, 111.0])) is False,
        "le lendemain, rester au-dessus ne redéclenche RIEN")

verifie(ce.cassure_aujourdhui(bougies(plat + [99.0])) is False,
        "une clôture sous le palier ne déclenche pas")

print("\n=== 2. Le plus haut est décalé d'un jour ===")
# Une hausse continue : chaque jour fait un nouveau plus haut. Sans le décalage,
# la bougie se comparerait à elle-même et la condition serait toujours fausse
# (close > son propre high) ou toujours vraie selon le sens de l'erreur.
montee = list(np.linspace(100, 160, 80))
resultats = [ce.cassure_aujourdhui(bougies(montee[: i + 1])) for i in range(60, 80)]
verifie(any(resultats) is False or sum(resultats) <= 1,
        "une hausse continue ne produit pas un signal par jour")

print("\n=== 3. Données insuffisantes ===")
verifie(ce.cassure_aujourdhui(bougies([100.0] * 10)) is False,
        "historique trop court -> aucun signal, pas d'exception")
verifie(ce.cassure_aujourdhui(None) is False, "DataFrame absent -> False")
verifie(ce.expansion_aujourdhui(bougies([100.0] * 30)) is False,
        "expansion : historique trop court -> False")
verifie(ce.expansion_aujourdhui(None) is False, "expansion : DataFrame absent -> False")

print("\n=== 4. L'expansion exige une journée HAUSSIÈRE ===")
# Longue compression (amplitude minuscule), puis un jour d'amplitude énorme.
rng = np.random.default_rng(7)
calme = list(100 + rng.normal(0, 0.05, 140))
haut = calme + [calme[-1] * 1.15]
bas = calme + [calme[-1] * 0.85]

df_haut = bougies(haut, opens=haut[:-1] + [calme[-1]])
df_bas = bougies(bas, opens=bas[:-1] + [calme[-1]])
verifie(ce.expansion_aujourdhui(df_bas) is False,
        "une expansion vers le BAS n'est jamais un signal d'achat")

print("\n=== 5. Le filtre de tendance commande les deux moteurs ===")
univers = {f"P{i}/USDT": bougies(plat + [110.0]) for i in range(5)}
verifie(ce.detect_cassure_signals(univers, btc(False)) == [],
        "marché défavorable -> aucune cassure émise")
verifie(ce.detect_expansion_signals(univers, btc(False)) == [],
        "marché défavorable -> aucune expansion émise")
verifie(ce.detect_cassure_signals(univers, bougies([100.0] * 20)) == [],
        "régime indéterminable -> aucun signal, refus par défaut")

signaux = ce.detect_cassure_signals(univers, btc(True))
verifie(len(signaux) > 0, "marché favorable -> le moteur émet")

print("\n=== 6. Les plafonds par moteur ===")
gros = {f"P{i}/USDT": bougies(plat + [110.0]) for i in range(20)}
verifie(len(ce.detect_cassure_signals(gros, btc(True))) == config.CASSURE_MAX_PAR_JOUR,
        f"jamais plus de CASSURE_MAX_PAR_JOUR = {config.CASSURE_MAX_PAR_JOUR} par jour")

print("\n=== 7. La géométrie est celle de la force relative ===")
s = signaux[0]
verifie(s["type"] == "BUY", "le moteur n'émet que des achats")
verifie(s["engine"] == ce.ENGINE_CASSURE, "moteur correctement étiqueté")
verifie(s["stop_loss"] < s["entry_price"] < s["tp1_price"] < s["tp2_price"] < s["tp3_price"],
        "stop sous l'entrée, objectifs croissants au-dessus")
ouverture = datetime.fromisoformat(s["created_at"])
cloture = datetime.fromisoformat(s["hold_until"])
verifie(round((cloture - ouverture).total_seconds() / 86400) == config.RS_HOLD_DAYS,
        f"sortie temporelle à {config.RS_HOLD_DAYS} jours, comme la force relative")

print("\n=== 8. Positions déjà ouvertes ===")
deja = {signaux[0]["pair"]}
emises = {x["pair"] for x in ce.detect_cassure_signals(univers, btc(True), already_open=deja)}
verifie(not (deja & emises), "une paire déjà détenue par CE moteur n'est jamais rouverte")

print("\n=== 9. L'arbitre connaît les deux nouveaux moteurs ===")
import signal_arbiter as arb
verifie(arb.esperance_par_jour(ce.ENGINE_CASSURE) > 0,
        "la cassure a un profil mesuré dans l'arbitre")
verifie(arb.esperance_par_jour(ce.ENGINE_EXPANSION) > 0,
        "l'expansion a un profil mesuré dans l'arbitre")
verifie(arb.esperance_par_jour(ce.ENGINE_EXPANSION) > arb.esperance_par_jour("relative_strength"),
        "toutes deux mieux classées que la force relative, comme la mesure le dit")
verifie(ce.ENGINE_CASSURE not in arb.MOTEURS_NEUTRES,
        "ce sont des paris directionnels : ils concourent pour le quota")

print("\n" + "=" * 60)
if echecs:
    print(f"{len(echecs)} VÉRIFICATION(S) EN ÉCHEC :")
    for e in echecs:
        print(f"  - {e}")
    raise SystemExit(1)
print("Toutes les vérifications passent.")
