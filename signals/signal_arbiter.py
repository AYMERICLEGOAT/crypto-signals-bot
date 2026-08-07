"""
L'arbitre : un juge unique pour tous les moteurs, avec un quota quotidien.

LE PROBLÈME. Chaque moteur décidait seul de ce qu'il émettait. Résultat : un
jour porteur, les quatre familles tirent ensemble et l'abonné reçoit dix
signaux d'un coup ; un jour creux, aucune ne tire et le canal est muet. Les
deux sont mauvais, et pour la même raison — personne ne regarde le total.

CE QUE FAIT L'ARBITRE. Il reçoit les candidats de TOUS les moteurs, les met sur
une échelle commune, les classe, et n'en laisse passer qu'un nombre borné.

LA DIFFICULTÉ RÉELLE : METTRE LES MOTEURS SUR LA MÊME ÉCHELLE.

Leurs espérances mesurées ne sont pas comparables telles quelles :

    force relative      +3,220 % par signal, tenu  7 jours
    momentum 4 h        +0,805 % par signal, tenu  3 jours
    carry de financement +0,572 % par position, tenue 21 jours

Prises au pied de la lettre, ces trois lignes diraient que la force relative
vaut six fois le carry. C'est faux : elles n'immobilisent pas le capital aussi
longtemps. Un carry qui rend +0,572 % en 21 jours et un momentum qui rend
+0,580 % en 3 jours ne sont pas la même affaire — le second travaille sept fois
plus vite.

L'unité commune est donc l'ESPÉRANCE PAR JOUR DE CAPITAL IMMOBILISÉ :

    force relative      +3,220 / 7  = +0,460 %/jour
    momentum 4 h        +0,805 / 3  = +0,268 %/jour
    carry               +0,572 / 21 = +0,027 %/jour

Le classement qui en découle est celui qu'un gérant utiliserait, et il est très
différent de celui des chiffres bruts. C'est cette valeur qui départage les
candidats quand il y en a plus que de places.

LE QUOTA. Entre QUOTA_MIN et QUOTA_MAX signaux par jour. Deux règles, et une
non-règle :

  - au-dessus du maximum, on garde les meilleurs et on laisse tomber le reste.
    Les candidats écartés ne sont pas mis en file d'attente : un signal de
    momentum vieux d'un jour n'est plus le même signal, et le republier demain
    reviendrait à entrer au mauvais prix ;
  - en dessous du minimum, on n'invente RIEN. C'est la non-règle, et c'est la
    plus importante : un quota plancher qui forcerait l'émission conduirait
    mécaniquement à diffuser les moins bons candidats du jour, c'est-à-dire
    exactement ceux dont la mesure dit qu'ils perdent. Le plancher sert à
    documenter l'objectif et à alerter quand il n'est pas tenu, jamais à
    fabriquer du signal.

Un candidat dont l'espérance est négative est écarté avant même le classement,
quel que soit le nombre de places libres.

LA PART MAXIMALE D'UN SEUL MOTEUR. Classer par espérance ne suffit pas : un
moteur qui produit beaucoup prend toutes les places d'un jour, et le classement
ne l'en empêche jamais puisque tous ses candidats portent la même espérance.
Constaté en conditions réelles dès le premier passage — le momentum 4 h, le
moteur dont l'avantage est le MOINS établi, occupait les cinq places.

C'est le contraire de ce qu'on veut. Un moteur en observation doit rester une
part minoritaire de ce que l'abonné reçoit, sans quoi l'étiquette « en
observation » ne veut plus rien dire : elle prévient d'un risque qu'on lui fait
courir en totalité. D'où un plafond par moteur, plus bas pour ceux qui sont en
observation.
"""

import logging

import config

logger = logging.getLogger(__name__)

# Espérance mesurée par signal et durée de détention, par moteur. Ces valeurs
# viennent des backtests nommés en commentaire ; aucune n'est estimée.
# Modifier l'une d'elles sans relancer le module correspondant fausserait
# l'arbitrage entre moteurs, qui repose entièrement dessus.
PROFILS = {
    # backtest_frontiere_production : top 12, 7 jours, filtre de tendance actif.
    "relative_strength": {"esperance_pct": 3.22, "jours": 7, "reussite_pct": 47.7},
    # backtest_carry_stop : 40 places, 21 jours, univers élargi, stop actif.
    "carry_funding": {"esperance_pct": 0.572, "jours": 21, "reussite_pct": 84.2},
    # backtest_4h : top 2, 3 jours, restreint aux marchés défavorables — la
    # configuration RÉELLEMENT publiée depuis que l'arbitre plafonne ce moteur
    # à deux places. Le chiffre du top 5 (+0,576 %) décrivait une moyenne
    # incluant des rangs qui ne sortent plus jamais.
    # EN OBSERVATION — voir momentum_4h.py : positif 3 années sur 4, mais en
    # décroissance monotone jusqu'au négatif sur l'année en cours.
    "momentum_4h": {"esperance_pct": 0.805, "jours": 3, "reussite_pct": 48.3},
    # Moteurs historiques, désactivés. Présents pour que l'arbitre ne plante pas
    # si un signal ancien réapparaît.
    "high_confidence": {"esperance_pct": 0.0, "jours": 7, "reussite_pct": 0.0},
    "squeeze_15m": {"esperance_pct": 0.0, "jours": 2, "reussite_pct": 0.0},
}


# Moteurs dont l'avantage n'est pas établi : mesurés positifs, mais sur un
# historique qui ne permet pas d'exclure que ce soit du hasard ou un avantage en
# train de disparaître. Ils publient, ils le disent, et ils ne prennent jamais
# la majorité du canal.
MOTEURS_EN_OBSERVATION = {"momentum_4h"}


def plafond_du_moteur(engine: str) -> int:
    """
    Nombre maximal de signaux qu'un moteur peut occuper en un jour.

    Un moteur en observation est limité à QUOTA_OBSERVATION_MAX. Les autres ne
    sont bornés que par le plafond global : quand la force relative trouve cinq
    bonnes candidates, il n'y a aucune raison de la brider — c'est le moteur
    dont l'espérance est la mieux établie du projet.
    """
    if engine in MOTEURS_EN_OBSERVATION:
        return config.QUOTA_OBSERVATION_MAX
    return config.QUOTA_SIGNAUX_MAX


def esperance_par_jour(engine: str) -> float:
    """
    Espérance en pourcentage par JOUR de capital immobilisé.

    C'est la seule grandeur qui permette de comparer un carry tenu trois
    semaines à un momentum tenu trois jours. Un moteur inconnu rend 0 : il ne
    sera jamais préféré à un moteur mesuré, mais il pourra passer s'il reste de
    la place, ce qui est le bon comportement pour un moteur ajouté sans profil.
    """
    profil = PROFILS.get(engine)
    if not profil or profil["jours"] <= 0:
        return 0.0
    return profil["esperance_pct"] / profil["jours"]


def arbitrer(candidats: list) -> tuple[list, list]:
    """
    Classe les candidats de tous les moteurs et applique le quota du jour.

    `candidats` est une liste de couples (signal, contexte) telle que
    main.run_once les assemble. Rend (retenus, ecartes), les deux dans le même
    format, pour que l'appelant puisse journaliser ce qui a été laissé de côté.

    Le tri est stable à espérance égale : l'ordre d'arrivée des moteurs est
    conservé, ce qui évite qu'un rééquilibrage change l'ordre des signaux d'un
    jour à l'autre sans raison.
    """
    if not candidats:
        return [], []

    # Un moteur dont l'espérance mesurée est négative ou nulle ne doit pas
    # occuper une place, même s'il en reste. C'est le cas des moteurs
    # historiques désactivés dont un signal traînerait.
    valides, rejetes = [], []
    for c in candidats:
        engine = c[0].get("engine", "")
        if esperance_par_jour(engine) <= 0 and engine in PROFILS:
            rejetes.append(c)
            logger.info(
                "[arbitre] %s (%s) écarté : espérance mesurée nulle ou négative.",
                c[0].get("pair"), engine,
            )
        else:
            valides.append(c)

    classes = sorted(valides, key=lambda c: -esperance_par_jour(c[0].get("engine", "")))

    # Remplissage place par place, en respectant à la fois le plafond global et
    # celui de chaque moteur. Un candidat refusé pour cause de plafond de moteur
    # ne bloque pas la suite : la place revient au meilleur candidat suivant
    # d'un AUTRE moteur, ce qui diversifie la journée au lieu de la tronquer.
    retenus, ecartes = [], list(rejetes)
    par_moteur = {}
    for c in classes:
        engine = c[0].get("engine", "")
        if len(retenus) >= config.QUOTA_SIGNAUX_MAX:
            ecartes.append(c)
            continue
        if par_moteur.get(engine, 0) >= plafond_du_moteur(engine):
            ecartes.append(c)
            logger.info(
                "[arbitre] %s (%s) écarté : ce moteur a déjà ses %d places du jour.",
                c[0].get("pair"), engine, plafond_du_moteur(engine),
            )
            continue
        par_moteur[engine] = par_moteur.get(engine, 0) + 1
        retenus.append(c)

    if ecartes:
        detail = ", ".join(
            f"{c[0].get('pair')} ({c[0].get('engine')})" for c in ecartes[:6]
        )
        logger.info(
            "[arbitre] %d candidat(s) retenu(s) sur %d, plafond quotidien à %d. "
            "Écartés : %s%s",
            len(retenus), len(candidats), config.QUOTA_SIGNAUX_MAX, detail,
            "..." if len(ecartes) > 6 else "",
        )

    if 0 < len(retenus) < config.QUOTA_SIGNAUX_MIN:
        # Signalé, jamais compensé. Compléter avec les moins bons candidats du
        # jour reviendrait à diffuser précisément ceux que la mesure dit
        # perdants — c'est la seule chose que ce projet s'interdit.
        logger.info(
            "[arbitre] %d signal(aux) seulement, sous l'objectif de %d. Le marché n'offre "
            "pas mieux aujourd'hui : rien n'est ajouté pour combler.",
            len(retenus), config.QUOTA_SIGNAUX_MIN,
        )
    elif not retenus:
        logger.info("[arbitre] Aucun candidat aujourd'hui. La liste du jour prend le relais.")

    for c in retenus:
        engine = c[0].get("engine", "?")
        logger.info(
            "[arbitre] retenu : %s (%s, %.3f %%/jour de capital)",
            c[0].get("pair"), engine, esperance_par_jour(engine),
        )
    return retenus, ecartes


def resume_pour_admin(retenus: list, ecartes: list) -> str:
    """Une ligne lisible pour les logs et les alertes, jamais pour les abonnés."""
    if not retenus and not ecartes:
        return "aucun candidat"
    par_moteur = {}
    for c in retenus:
        par_moteur[c[0].get("engine", "?")] = par_moteur.get(c[0].get("engine", "?"), 0) + 1
    detail = ", ".join(f"{n} {m}" for m, n in sorted(par_moteur.items()))
    return f"{len(retenus)} retenu(s) [{detail}], {len(ecartes)} écarté(s)"
