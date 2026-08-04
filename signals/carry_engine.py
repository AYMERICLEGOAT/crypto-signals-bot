"""
Moteur Carry de Financement : la seule famille qui produit en marché baissier.

Ce que c'est. Une position NEUTRE AU MARCHÉ, en deux jambes simultanées de même
montant : on achète le spot, on vend le perpétuel. Quand le prix monte, la jambe
spot gagne ce que la jambe perpétuelle perd, et inversement. La position ne
dépend donc pas de la direction du marché. Le rendement vient uniquement du
FINANCEMENT, ce taux versé toutes les 8 heures entre acheteurs et vendeurs de
perpétuels — historiquement positif 74,2 % des jours, parce que les acheteurs à
effet de levier sont plus nombreux. C'est le vendeur qui encaisse.

Pourquoi ce moteur existe. Les trois autres familles du projet (force relative,
cassure de canal, expansion de volatilité) sont directionnelles : elles gagnent
en marché haussier et perdent en baissier. Sept façons de gagner en marché
baissier ont été testées, six réfutées au témoin aléatoire — vente à découvert
transversale (p = 1,000), cassure baissière (p = 0,583), rebond de capitulation
(p = 0,650). Le carry est la seule qui survit, et de loin :

    marché favorable   : +1,549 % par position, 93,3 % de gagnantes
    marché défavorable : +0,312 % par position, 75,5 % de gagnantes
    sept années positives sur sept, 2022 et 2026 comprises

Il est aussi le seul dont la MÉDIANE est positive (+0,49 %). Les familles
directionnelles ont une médiane négative : leur rentabilité vient d'une minorité
de gros gagnants, donc l'abonné doit tout prendre. Ici chaque position est
individuellement satisfaisante, ce qui change complètement le vécu.

FORME LIVRÉE, et pourquoi elle diffère du backtest d'origine. Les mesures de
validation rééquilibraient par blocs : 20 positions ouvertes le même jour,
tenues 21 jours, tout refermé, on recommence. Correct statistiquement,
inexploitable pour un canal — les abonnés recevraient 20 signaux d'un coup puis
rien pendant trois semaines. Le moteur évalue donc CHAQUE jour et ouvre dès
qu'une place se libère. Mesuré sous cette forme exacte
(backtest_carry_production) : 0,69 signal par jour, 87,2 % de positions
gagnantes, +0,662 % net, pire position -3,86 %, sept années positives sur sept.

DEUX GARDE-FOUS, mesurés et non supposés :

  - Un PLAFOND sur le financement d'entrée. Un taux extrême ne signale pas une
    bonne affaire mais une manie, et c'est précisément là que se logent les
    pertes rares et énormes : sans plafond, sur univers élargi, la pire position
    observée atteignait -68 %. Avec, elle reste à -3,86 %.
  - Un PLANCHER, pour ne pas ouvrir une position dont le financement ne couvre
    même pas ses propres frais. Ouvrir un carry coûte deux allers-retours (spot
    et perpétuel), soit 0,20 % : en dessous d'un certain taux, la position est
    perdante d'avance.

La durée de 21 jours n'est pas un réglage libre. À 14 jours la pire position
passe à -30,18 % et on tombe à cinq années positives sur sept ; à 21 elle reste
à -3,86 % avec sept sur sept. C'est un seuil, pas un curseur.

CE QUE CE MOTEUR N'EST PAS. Ce n'est pas « sans risque ». La jambe vendeuse peut
être liquidée si la marge devient insuffisante, le prix du perpétuel peut
s'écarter durablement de celui du spot, et il reste un risque de plateforme.
Aucune communication ne doit laisser croire le contraire.

Module de validation : backtest_carry_funding, backtest_carry_frontiere,
backtest_carry_univers, backtest_carry_production.
"""

import json
import logging
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

import config

logger = logging.getLogger(__name__)

ENGINE_NAME = "carry_funding"

# Endpoints de financement, essayés dans l'ordre. Binance bloque les IP de
# certains hébergeurs (451 observé depuis les runners GitHub Actions sur l'API
# spot), d'où le miroir : sans lui le moteur tomberait en panne silencieuse dès
# le premier passage en production.
_ENDPOINTS = (
    "https://fapi.binance.com/fapi/v1/fundingRate",
    "https://www.binance.com/fapi/v1/fundingRate",
)
_HEADERS = {"User-Agent": "crypto-signals-bot"}


def _lire_json(url: str, timeout: int = 20):
    requete = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(requete, timeout=timeout) as reponse:
        return json.load(reponse)


def fetch_funding_history(symbole: str, jours: int) -> list | None:
    """
    Taux de financement des `jours` derniers jours, en pourcentage par versement.

    Retourne None si aucune source ne répond — et non une liste vide, pour que
    l'appelant distingue « pas de données » de « financement nul ».
    """
    depuis = int((datetime.now(timezone.utc) - timedelta(days=jours + 2)).timestamp() * 1000)
    for base in _ENDPOINTS:
        url = f"{base}?symbol={symbole}&startTime={depuis}&limit=1000"
        try:
            lignes = _lire_json(url)
        except urllib.error.HTTPError as err:
            logger.warning("[%s] %s a répondu %s pour %s.", ENGINE_NAME, base, err.code, symbole)
            continue
        except Exception:
            logger.warning("[%s] %s injoignable pour %s.", ENGINE_NAME, base, symbole, exc_info=True)
            continue
        if lignes:
            return [float(l["fundingRate"]) * 100 for l in lignes]
    return None


def taux_moyen_journalier(versements: list) -> float | None:
    """
    Financement moyen par JOUR, à partir des versements toutes les 8 heures.

    Trois versements par jour : la moyenne par versement est donc multipliée
    par trois. Sur un historique tronqué (paire récemment listée) le calcul
    reste juste, puisqu'il ne dépend pas du nombre total de lignes.
    """
    if not versements:
        return None
    return sum(versements) / len(versements) * 3


def classer_paires(funding_par_paire: dict) -> list:
    """
    Classe les paires par financement journalier décroissant, après application
    du plancher et du plafond. Une paire sans données est écartée plutôt que
    classée au pire rang : la faire figurer serait inventer une information.
    """
    scores = {}
    for pair, versements in funding_par_paire.items():
        taux = taux_moyen_journalier(versements)
        if taux is None:
            continue
        if taux < config.CARRY_MIN_FUNDING_PCT_PER_DAY:
            continue  # ne couvre même pas ses frais
        if taux > config.CARRY_MAX_FUNDING_PCT_PER_DAY:
            logger.info(
                "[%s] %s écartée : financement de %.4f %%/jour au-dessus du plafond de %.4f. "
                "Un taux extrême signale une manie, pas une bonne affaire — c'est là que se "
                "logent les pertes rares et énormes.",
                ENGINE_NAME, pair, taux, config.CARRY_MAX_FUNDING_PCT_PER_DAY,
            )
            continue
        scores[pair] = taux
    return sorted(scores.items(), key=lambda kv: -kv[1])


def build_signal(pair: str, prix_spot: float, taux_journalier: float, rang: int,
                 timestamp=None) -> dict:
    """
    Construit le signal de carry.

    `entry_price` porte le prix du spot : c'est le niveau auquel les deux jambes
    sont ouvertes, et il sert à dimensionner la position. Il n'y a en revanche
    NI stop_loss NI take_profit — la position se ferme sur une durée, pas sur un
    prix, et une position neutre au marché n'a pas de niveau de prix qui la
    menace. Les laisser à None est le seul choix honnête ; c'est ce que permet
    la migration de la section 46 d'init.sql.
    """
    maintenant = timestamp or datetime.now(timezone.utc)
    attendu = taux_journalier * config.CARRY_HOLD_DAYS - config.CARRY_ROUND_TRIP_COST_PCT
    return {
        "pair": pair,
        "type": "CARRY",
        "entry_price": round(prix_spot, 8),
        "stop_loss": None,
        "take_profit": None,
        "created_at": maintenant.isoformat(),
        "engine": ENGINE_NAME,
        # Ce qui est annoncé à l'abonné : le financement net attendu sur la
        # durée de détention, frais déduits. À NE JAMAIS présenter comme acquis —
        # mesuré sur 6 ans, seules 41 % des positions atteignent le montant
        # annoncé, pour une corrélation annoncé/réalisé de +0,49.
        "carry_expected_pct": round(attendu, 4),
        "hold_until": (maintenant + timedelta(days=config.CARRY_HOLD_DAYS)).isoformat(),
        # Métadonnées de journalisation, retirées avant insertion.
        "carry_rate_per_day": round(taux_journalier, 5),
        "carry_rank": rang,
    }


def detect_carry_signals(funding_par_paire: dict, prix_spot: dict,
                         already_open: set = None, places_libres: int = None,
                         timestamp=None) -> list:
    """
    Point d'entrée. Rend la liste des carrys à ouvrir aujourd'hui.

    `places_libres` est le nombre de positions qu'on peut encore ouvrir, calculé
    par l'appelant à partir des positions en cours. C'est ce qui donne au moteur
    sa cadence : avec N places et D jours de détention, il ouvre N/D position par
    jour en moyenne, réparties au fil des jours au lieu d'arriver en rafale.
    """
    already_open = already_open or set()
    if places_libres is None:
        places_libres = config.CARRY_MAX_POSITIONS - len(already_open)
    if places_libres <= 0:
        logger.info("[%s] %d position(s) déjà ouverte(s) sur %d : aucune place libre.",
                    ENGINE_NAME, len(already_open), config.CARRY_MAX_POSITIONS)
        return []

    classement = classer_paires(funding_par_paire)
    if not classement:
        logger.info(
            "[%s] Aucune paire ne dépasse le plancher de %.4f %%/jour : le financement "
            "ne couvre nulle part ses frais aujourd'hui, on n'ouvre rien.",
            ENGINE_NAME, config.CARRY_MIN_FUNDING_PCT_PER_DAY,
        )
        return []

    signaux = []
    for rang, (pair, taux) in enumerate(classement, start=1):
        if len(signaux) >= places_libres:
            break
        if pair in already_open:
            continue
        prix = prix_spot.get(pair)
        if not prix or prix <= 0:
            logger.warning("[%s] %s : prix spot indisponible, position non ouverte.", ENGINE_NAME, pair)
            continue
        signaux.append(build_signal(pair, prix, taux, rang, timestamp))

    if signaux:
        logger.info(
            "[%s] %d carry(s) ouvert(s) sur %d place(s) libre(s) : %s",
            ENGINE_NAME, len(signaux), places_libres,
            ", ".join(f"{s['pair']} ({s['carry_rate_per_day']:.4f} %/j, "
                      f"attendu {s['carry_expected_pct']:+.2f} %)" for s in signaux),
        )
    return signaux
