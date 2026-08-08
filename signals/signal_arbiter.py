"""
L'arbitre : un juge unique pour tous les moteurs, avec un quota quotidien.

LE PROBLÈME. Chaque moteur décidait seul de ce qu'il émettait. Résultat : un
jour porteur, tous les moteurs tirent ensemble et l'abonné reçoit dix
signaux d'un coup ; un jour creux, aucune ne tire et le canal est muet. Les
deux sont mauvais, et pour la même raison — personne ne regarde le total.

CE QUE FAIT L'ARBITRE. Il reçoit les candidats de TOUS les moteurs, les met sur
une échelle commune, les classe, et n'en laisse passer qu'un nombre borné.

LA DIFFICULTÉ RÉELLE : METTRE LES MOTEURS SUR LA MÊME ÉCHELLE.

Leurs espérances mesurées ne sont pas comparables telles quelles :

    expansion de volatilité +4,992 % par signal, tenu  7 jours
    cassure de canal        +4,657 % par signal, tenu  7 jours
    force relative          +2,275 % par signal, tenu  7 jours
    momentum 4 h            +0,805 % par signal, tenu  3 jours
    carry de financement    +0,572 % par position, tenue 21 jours

Prises au pied de la lettre, ces lignes diraient que l'expansion de volatilité
vaut neuf fois le carry. C'est faux : elles n'immobilisent pas le capital aussi
longtemps. Un carry qui rend +0,572 % en 21 jours et un momentum qui rend
+0,805 % en 3 jours ne sont pas la même affaire — le second travaille sept fois
plus vite.

L'unité commune est donc l'ESPÉRANCE PAR JOUR DE CAPITAL IMMOBILISÉ :

    expansion de volatilité +4,992 / 7  = +0,713 %/jour
    cassure de canal        +4,657 / 7  = +0,665 %/jour
    force relative          +2,275 / 7  = +0,325 %/jour
    momentum 4 h            +0,805 / 3  = +0,268 %/jour
    carry                   +0,572 / 21 = +0,027 %/jour

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
    # LES TROIS MOTEURS DIRECTIONNELS SONT MESURÉS AVEC LE MÊME PROTOCOLE, et
    # c'est indispensable : entrée à la clôture du lendemain, sortie à la
    # clôture après 7 jours, frais déduits, filtre de tendance actif, aucun
    # stop. Les chiffres précédents mêlaient des mesures avec et sans stop
    # intrabar — soit deux stratégies différentes comparées comme si elles
    # étaient la même chose, exactement l'incomparabilité que ce module existe
    # pour supprimer.
    #
    # L'espérance de la force relative passe de 3,22 % à 2,275 %, et ce n'est pas
    # une dégradation du moteur : c'est la fin d'une comparaison faussée.
    #
    # À noter, parce que l'écart est troublant et qu'il a été vérifié : le
    # +3,22 % publié partout ne se REPRODUIT PAS sur les 40 paires réellement
    # suivies. Le module canonique du projet (backtest_rsi_production) y donne
    # +2,831 % et 48,3 % de réussite. Les textes publics ont été corrigés en
    # conséquence. La valeur retenue ici (2,275 %) reste celle du protocole
    # commun aux trois moteurs directionnels, qui est le seul à permettre de les
    # CLASSER entre eux — c'est l'unique usage de ce dictionnaire.
    "relative_strength": {"esperance_pct": 2.275, "jours": 7, "reussite_pct": 47.3},
    # backtest_deux_familles : mesurées seules, filtre actif, p = 0,000 contre
    # un témoin aléatoire de même densité.
    "cassure_canal": {"esperance_pct": 4.657, "jours": 7, "reussite_pct": 49.3},
    "expansion_volatilite": {"esperance_pct": 4.992, "jours": 7, "reussite_pct": 51.6},
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

# Moteurs NEUTRES AU MARCHÉ : leurs positions n'exposent l'abonné à aucune
# direction de prix, et ne consomment donc pas la même ressource que les paris
# directionnels. Ils échappent au quota quotidien pour la même raison qu'ils
# échappent au verrou de portefeuille (voir storage.count_open_at_risk_trades).
MOTEURS_NEUTRES = {"carry_funding"}


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

    # LES CARRYS NE CONCOURENT PAS POUR LES MÊMES PLACES.
    #
    # Le quota borne le nombre de PARIS DIRECTIONNELS envoyés dans la journée.
    # Un carry n'en est pas un : ses deux jambes s'annulent, il n'occupe aucune
    # part du risque de marché de l'abonné, et il a déjà son propre plafond
    # (config.CARRY_MAX_NEW_PER_DAY).
    #
    # Les mettre en concurrence produisait un résultat absurde : la force
    # relative rend 0,460 %/jour contre 0,027 % au carry, elle passe donc
    # systématiquement devant, et un jour où elle trouve cinq candidates le
    # carry n'obtient plus aucune place — alors même qu'il est le moteur dont
    # l'avantage est le mieux établi du projet (84,2 % de positions gagnantes,
    # sept années positives sur sept). Comparer leurs espérances par jour de
    # capital a du sens pour choisir entre deux directionnels ; cela n'en a
    # aucun pour arbitrer entre un pari sur le prix et une position qui n'en
    # est pas un.
    carrys = [c for c in candidats if c[0].get("engine") in MOTEURS_NEUTRES]
    candidats = [c for c in candidats if c[0].get("engine") not in MOTEURS_NEUTRES]

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

    # UNE PLACE GARANTIE À CHAQUE MOTEUR QUI A QUELQUE CHOSE À DIRE.
    #
    # Sans ce premier tour, le classement par espérance suffit à faire taire un
    # moteur entier : la force relative rend 0,460 %/jour contre 0,268 % au
    # momentum 4 h, ses candidats passent donc tous devant, et cinq candidates
    # de force relative un même jour ne laissent rien aux autres.
    #
    # Le cas est aujourd'hui théorique — ces deux moteurs travaillent dans des
    # régimes opposés et ne se rencontrent jamais. Mais une garantie qui ne
    # tient que par la configuration du moment n'est pas une garantie : il
    # suffirait d'ajouter un sixième moteur pour que le problème devienne réel,
    # et personne ne s'en apercevrait puisque rien ne planterait.
    #
    # Premier tour : le meilleur candidat de chaque moteur, dans l'ordre des
    # espérances. Second tour : le reste des places, au mérite.
    retenus, ecartes = [], list(rejetes)
    par_moteur = {}
    deja_servi = set()

    def peut_prendre(c) -> bool:
        engine = c[0].get("engine", "")
        return (
            len(retenus) < config.QUOTA_SIGNAUX_MAX
            and par_moteur.get(engine, 0) < plafond_du_moteur(engine)
        )

    def prendre(c) -> None:
        engine = c[0].get("engine", "")
        par_moteur[engine] = par_moteur.get(engine, 0) + 1
        deja_servi.add(engine)
        retenus.append(c)

    for c in classes:
        engine = c[0].get("engine", "")
        if engine not in deja_servi and peut_prendre(c):
            prendre(c)

    for c in classes:
        if c in retenus:
            continue
        if len(retenus) >= config.QUOTA_SIGNAUX_MAX:
            ecartes.append(c)
            continue
        if not peut_prendre(c):
            ecartes.append(c)
            logger.info(
                "[arbitre] %s (%s) écarté : ce moteur a déjà ses %d places du jour.",
                c[0].get("pair"), c[0].get("engine"), plafond_du_moteur(c[0].get("engine", "")),
            )
            continue
        prendre(c)

    # Les carrys reviennent APRÈS le remplissage, sans avoir concouru. Ils sont
    # déjà bornés en amont par CARRY_MAX_NEW_PER_DAY (voir carry_engine.py) :
    # les recompter ici serait un second plafond, et le plus serré des deux
    # gagnerait en silence.
    retenus.extend(carrys)

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
