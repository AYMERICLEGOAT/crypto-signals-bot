"""
Vérification du moteur Carry de Financement, sans pytest (assertions simples).

Ce moteur est le premier à émettre un type de signal que rien d'autre ne sait
traiter, et sa position est NEUTRE AU MARCHÉ. Deux erreurs y passeraient
totalement inaperçues en production :

  - émettre avec un stop ou un objectif renseigné, ce qui ferait clôturer la
    position par le suivi par prix sur un mouvement de cours auquel elle est
    par construction insensible ;
  - ignorer le plafond de financement, qui est le seul garde-fou contre les
    pertes rares et énormes (-68 % mesuré sans lui sur univers élargi).

Les deux sont vérifiées explicitement ici.

Usage : python test_carry_engine.py
"""

from datetime import datetime, timezone

import config
import carry_engine as ce

echecs = []


def verifie(condition, message):
    if condition:
        print(f"  OK   {message}")
    else:
        print(f"  ECHEC {message}")
        echecs.append(message)


def versements(taux_journalier, jours=21):
    """
    Le moteur reçoit désormais des taux déjà normalisés en % PAR JOUR : chaque
    source convertit son propre rythme de versement avant de rendre la valeur
    (8 heures chez Binance et Bybit, 1 heure chez Hyperliquid). Confondre les
    deux diviserait le taux par huit et viderait le classement.
    """
    return taux_journalier


print("\n=== 1. Notation des symboles ===")
verifie(ce.format_pair("BTCUSDT") == "BTC/USDT",
        "symbole de plateforme converti vers la notation du projet")
verifie(ce.format_pair("BTC/USDT") == "BTC/USDT",
        "un symbole déjà converti reste inchangé")

print("\n=== 2. Plancher et plafond ===")
univers = {
    "BON/USDT": versements(0.05),
    "TROP_FAIBLE/USDT": versements(0.005),   # sous le plancher : ne couvre pas les frais
    "MANIE/USDT": versements(0.40),          # au-dessus du plafond : financement de manie
    "CORRECT/USDT": versements(0.03),
}
classement = dict(ce.classer_paires(univers))
verifie("BON/USDT" in classement and "CORRECT/USDT" in classement,
        "les paires dans la fourchette sont retenues")
verifie("TROP_FAIBLE/USDT" not in classement,
        f"sous le plancher de {config.CARRY_MIN_FUNDING_PCT_PER_DAY} %/jour -> écartée (perdante d'avance)")
verifie("MANIE/USDT" not in classement,
        f"au-dessus du plafond de {config.CARRY_MAX_FUNDING_PCT_PER_DAY} %/jour -> écartée "
        "(c'est là que se logent les pertes énormes)")

ordre = [p for p, _ in ce.classer_paires(univers)]
verifie(ordre == ["BON/USDT", "CORRECT/USDT"],
        "classement par financement DÉCROISSANT")

print("\n=== 3. Le signal n'a NI stop NI objectif ===")
signaux = ce.detect_carry_signals(univers, {"BON/USDT": 100.0, "CORRECT/USDT": 50.0})
verifie(len(signaux) == 2, "un signal par paire éligible")
s = signaux[0]
verifie(s["type"] == "CARRY", "type CARRY, ni BUY ni SELL")
verifie(s["stop_loss"] is None,
        "stop_loss à None — un prix ne peut pas menacer une position neutre au marché")
verifie(s["take_profit"] is None,
        "take_profit à None — la sortie est temporelle, pas sur objectif de prix")
verifie(s["engine"] == "carry_funding", "moteur correctement étiqueté")
verifie(s["entry_price"] == 100.0, "prix de référence = prix spot fourni")

print("\n=== 4. Financement attendu et date de clôture ===")
# BON/USDT à 0,05 %/jour sur 21 jours = 1,05 %, moins 0,20 % de frais = 0,85 %.
attendu = 0.05 * config.CARRY_HOLD_DAYS - config.CARRY_ROUND_TRIP_COST_PCT
verifie(abs(s["carry_expected_pct"] - attendu) < 1e-6,
        f"financement attendu = taux x durée - frais ({attendu:+.2f} %)")
verifie(s["carry_expected_pct"] > 0,
        "le plancher garantit un attendu positif : on n'annonce jamais une perte certaine")
ouverture = datetime.fromisoformat(s["created_at"])
cloture = datetime.fromisoformat(s["hold_until"])
verifie(abs((cloture - ouverture).days - config.CARRY_HOLD_DAYS) <= 1,
        f"clôture prévue {config.CARRY_HOLD_DAYS} jours après l'ouverture")

print("\n=== 5. Places disponibles et positions déjà ouvertes ===")
# Univers plus large que le nombre de places, pour que le plafonnement soit
# réellement testé (CARRY_MAX_POSITIONS vaut 40).
large = {f"P{i}/USDT": versements(0.05 - i * 0.0002) for i in range(60)}
prix = {f"P{i}/USDT": 10.0 for i in range(60)}
verifie(len(ce.detect_carry_signals(large, prix)) == config.CARRY_MAX_NEW_PER_DAY,
        f"au plus CARRY_MAX_NEW_PER_DAY = {config.CARRY_MAX_NEW_PER_DAY} ouvertures par jour, "
        "même avec 40 places libres : un démarrage à froid ne doit pas produire de rafale")
verifie(len(ce.detect_carry_signals(large, prix, places_libres=2)) == 2,
        "moins de places libres que le plafond quotidien -> c'est le nombre de places qui borne")
verifie(config.CARRY_MAX_NEW_PER_DAY < config.CARRY_MAX_POSITIONS,
        "le plafond quotidien est bien plus bas que le nombre de places : c'est ce qui "
        "étale le remplissage du carnet")
verifie(ce.detect_carry_signals(large, prix, places_libres=0) == [],
        "aucune place libre -> aucun signal")
deja = {"P0/USDT", "P1/USDT"}
emises = {x["pair"] for x in ce.detect_carry_signals(large, prix, already_open=deja, places_libres=5)}
verifie(not (deja & emises), "une paire déjà en position n'est jamais rouverte")

print("\n=== 6. Dégradation quand les données manquent ===")
verifie(ce.detect_carry_signals({}, {}) == [],
        "aucun financement disponible -> aucun signal")
verifie(ce.detect_carry_signals({"X/USDT": versements(0.05)}, {}) == [],
        "financement connu mais prix spot absent -> aucun signal (rien n'est inventé)")
sous_plancher = {f"Q{i}/USDT": versements(0.001) for i in range(10)}
verifie(ce.detect_carry_signals(sous_plancher, {f"Q{i}/USDT": 1.0 for i in range(10)}) == [],
        "aucune paire au-dessus du plancher -> aucun signal, on n'ouvre pas pour occuper le canal")

print("\n=== 7. Cohérence des constantes ===")
verifie(config.CARRY_MIN_FUNDING_PCT_PER_DAY * config.CARRY_HOLD_DAYS
        > config.CARRY_ROUND_TRIP_COST_PCT,
        "le plancher x la durée dépasse les frais aller-retour des deux jambes")
verifie(config.CARRY_MIN_EXPECTED_PCT > 0,
        "l'espérance annoncée minimale est strictement positive : on n'envoie "
        "jamais un signal dont le gain attendu serait nul ou négatif")
au_plancher = {f"R{i}/USDT": versements(config.CARRY_MIN_FUNDING_PCT_PER_DAY) for i in range(20)}
verifie(ce.classer_paires(au_plancher) == [],
        "une paire pile au plancher est écartée : son espérance annoncée serait dérisoire")
verifie(config.CARRY_MAX_FUNDING_PCT_PER_DAY > config.CARRY_MIN_FUNDING_PCT_PER_DAY,
        "plafond au-dessus du plancher")
verifie(config.CARRY_HOLD_DAYS >= 21,
        "durée d'au moins 21 jours : à 14 jours la pire position mesurée passe de "
        "-3,86 % à -30,18 % et on tombe à 5 années positives sur 7")

print("\n" + "=" * 60)
if echecs:
    print(f"{len(echecs)} VÉRIFICATION(S) EN ÉCHEC :")
    for e in echecs:
        print(f"  - {e}")
    raise SystemExit(1)
print("Toutes les vérifications passent.")
