"""
Moteur Carry de Financement : la mieux établie des familles qui produisent en
marché baissier.

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
validation rééquilibraient par blocs : toutes les positions ouvertes le même
jour, tenues 21 jours, tout refermé, on recommence. Correct statistiquement,
inexploitable pour un canal — les abonnés recevraient quarante signaux d'un coup
puis rien pendant trois semaines. Le moteur évalue donc CHAQUE jour et ouvre dès
qu'une place se libère, ce qui étale le débit au lieu de le concentrer.

Mesuré sous la forme exacte livrée (backtest_carry_stop, univers élargi,
40 places, stop actif) : 1,29 signal par jour, 84,2 % de positions gagnantes,
+0,572 % net, six années positives sur sept — la septième, 2022, est à -0,046 %
par position, donc plate et non perdante.

TROIS GARDE-FOUS, mesurés et non supposés :

  - Un PLAFOND sur le financement d'entrée. Un taux extrême ne signale pas une
    bonne affaire mais une manie, et c'est précisément là que se logent les
    pertes rares et énormes.
  - Un PLANCHER, doublé d'une espérance annoncée minimale. Ouvrir un carry coûte
    deux allers-retours (spot et perpétuel), soit 0,20 % : en dessous d'un
    certain taux la position est perdante d'avance, et juste au-dessus elle
    rapporterait un gain annoncé dérisoire qu'il serait absurde d'envoyer.
  - Un STOP SUR LE FINANCEMENT CUMULÉ. Le financement d'un perpétuel peut
    s'INVERSER lors d'un squeeze : ce sont alors les vendeurs qui paient,
    parfois pendant plusieurs jours, et rien n'arrêtait la position avant son
    terme. Mesuré : la pire position passe de -66,70 % à -19,86 %, l'espérance
    MONTE de +0,656 % à +0,761 %, et seules 1,7 % des positions le déclenchent —
    il ne coupe donc pas de gagnantes, contrairement au stop de prix des
    familles directionnelles où plus il était serré, plus il coûtait cher.
    Le suivi (Worker) l'évalue à chaque passage, pas seulement à l'échéance.

Il reste -19,86 % de perte possible sur une position, due à une journée unique
à financement extrême qu'un stop quotidien ne peut qu'encadrer après coup. C'est
le risque résiduel assumé, et il doit être dit aux abonnés.

La durée de 21 jours n'est pas un réglage libre. À 14 jours la pire position
passe à -30,18 % et on tombe à cinq années positives sur sept. C'est un seuil,
pas un curseur.

CONTRIBUTION AU SYSTÈME COMPLET. Avec les trois familles directionnelles, le
canal passe à 4,35 signaux par jour en marché favorable et 1,15 en défavorable,
soit 2,99 en moyenne, et 80 % des jours comportent au moins un signal — contre
53 % avant l'ajout de ce moteur.

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
    "https://fapi1.binance.com/fapi/v1/fundingRate",
    "https://fapi2.binance.com/fapi/v1/fundingRate",
)
_HEADERS = {"User-Agent": "crypto-signals-bot"}


_STABLES = {
    "USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT",
    "USDPUSDT", "AEURUSDT", "XUSDUSDT", "USD1USDT", "PYUSDUSDT", "EURIUSDT",
}


def _lire_json(url: str, timeout: int = 20):
    requete = urllib.request.Request(url, headers=_HEADERS)
    with urllib.request.urlopen(requete, timeout=timeout) as reponse:
        return json.load(reponse)


def _lire_json_multi(chemins: tuple, timeout: int = 30):
    """
    Premier miroir qui répond. Binance bloque géographiquement certains
    hébergeurs — 451 depuis les runners GitHub Actions, 403 depuis Cloudflare —
    et une source unique fait tomber le moteur en panne silencieuse. C'est
    exactement ce qui s'est produit au premier passage en production du carry.
    """
    for url in chemins:
        try:
            return _lire_json(url, timeout=timeout)
        except Exception as err:
            logger.info("[%s] %s indisponible (%s), miroir suivant.", ENGINE_NAME, url, type(err).__name__)
    return None


_MIROIRS_PERPS = (
    "https://fapi.binance.com/fapi/v1/ticker/24hr",
    "https://www.binance.com/fapi/v1/ticker/24hr",
)
_MIROIRS_SPOT = (
    "https://api.binance.com/api/v3/exchangeInfo",
    "https://api1.binance.com/api/v3/exchangeInfo",
    "https://api2.binance.com/api/v3/exchangeInfo",
    "https://data-api.binance.vision/api/v3/exchangeInfo",
)


# --------------------------------------------------------------------------
# Source de repli : Bybit.
#
# Binance bloque géographiquement les runners GitHub Actions — 451 sur l'API
# spot, et TOUS les miroirs futures se sont révélés inaccessibles au premier
# passage en production. Sans seconde plateforme, le moteur ne peut simplement
# pas tourner là où il est censé tourner.
#
# Bybit cote les mêmes perpétuels USDT, verse aussi le financement toutes les
# 8 heures, et son API publique ne demande aucune clé.
#
# Une honnêteté à garder en tête : les taux de Bybit et de Binance ne sont pas
# identiques, même s'ils restent très proches — l'arbitrage les tient ensemble.
# Le backtest a été mené sur les données Binance ; utiliser Bybit pour le
# classement en direct introduit donc un léger écart de mesure. C'est acceptable
# parce que l'abonné exécute de toute façon sur SA plateforme, et que le
# classement relatif entre paires est bien plus stable que le niveau absolu.
# --------------------------------------------------------------------------

_BYBIT_TICKERS = "https://api.bybit.com/v5/market/tickers?category=linear"
_BYBIT_FUNDING = "https://api.bybit.com/v5/market/funding/history"
_HYPERLIQUID = "https://api.hyperliquid.xyz/info"


def _univers_bybit(taille: int) -> list:
    data = _lire_json_multi((_BYBIT_TICKERS,))
    if not data:
        return []
    lignes = [
        x for x in data.get("result", {}).get("list", [])
        if x.get("symbol", "").endswith("USDT") and x["symbol"] not in _STABLES
    ]
    lignes.sort(key=lambda x: -float(x.get("turnover24h") or 0))
    return [x["symbol"] for x in lignes[:taille]]


def _funding_bybit(symbole: str, jours: int) -> list | None:
    depuis = int((datetime.now(timezone.utc) - timedelta(days=jours + 2)).timestamp() * 1000)
    url = f"{_BYBIT_FUNDING}?category=linear&symbol={symbole}&startTime={depuis}&limit=200"
    data = _lire_json_multi((url,), timeout=20)
    if not data:
        return None
    lignes = data.get("result", {}).get("list", [])
    return [float(l["fundingRate"]) * 100 for l in lignes] if lignes else None


def _univers_hyperliquid(taille: int) -> list:
    """
    Marchés Hyperliquid classés par volume sur 24 h, ramenés à la notation
    "XXXUSDT" pour rester homogènes avec le reste du moteur.
    """
    try:
        meta = _hyperliquid({"type": "metaAndAssetCtxs"})
    except Exception:
        return []
    noms = [u["name"] for u in meta[0].get("universe", [])]
    contextes = meta[1] if len(meta) > 1 else []
    lignes = [
        (n, float(c.get("dayNtlVlm") or 0))
        for n, c in zip(noms, contextes)
    ]
    lignes.sort(key=lambda x: -x[1])
    return [f"{n}USDT" for n, _v in lignes[:taille] if f"{n}USDT" not in _STABLES]


def univers_carry(taille: int) -> list:
    """
    Les `taille` perpétuels les plus échangés qui possèdent AUSSI une paire au
    comptant sur Binance.

    Les deux conditions sont indispensables et pour des raisons différentes.
    Le volume, parce qu'un carry sur un perpétuel sans profondeur est un signal
    que personne ne peut suivre. La paire au comptant, parce qu'un carry a deux
    jambes : sans spot, il n'y a rien à acheter en face de la vente du
    perpétuel, et la position ne serait plus neutre au marché mais une simple
    vente à découvert — exactement ce que ce moteur ne fait pas.

    L'univers est reconstruit à chaque passage plutôt que figé dans config.py :
    la liste des perpétuels change, et un symbole retiré doit disparaître du
    classement sans intervention.

    DÉGRADATION, par ordre de préférence :
      1. perpétuels classés par volume, croisés avec les paires au comptant ;
      2. si la liste au comptant est injoignable mais pas celle des perpétuels,
         on garde le classement par volume sans le croisement. Le risque est
         d'inclure un perpétuel sans spot, auquel cas la position n'est pas
         exécutable — mais elle serait de toute façon écartée faute de prix
         au comptant (voir fetch_spot_price), donc rien d'incorrect ne part ;
      3. si les perpétuels eux-mêmes sont injoignables, repli sur les paires du
         projet, qui ont toutes un perpétuel et un spot. L'univers est trois
         fois plus petit, donc moins de signaux, mais le moteur continue de
         tourner au lieu de s'éteindre en silence.
    """
    perps = _lire_json_multi(_MIROIRS_PERPS)
    if not perps:
        bybit = _univers_bybit(taille)
        if bybit:
            logger.info(
                "[%s] Binance injoignable : univers construit depuis Bybit (%d perpétuels).",
                ENGINE_NAME, len(bybit),
            )
            return bybit
        hl = _univers_hyperliquid(taille)
        if hl:
            logger.info(
                "[%s] Binance et Bybit injoignables : univers construit depuis Hyperliquid "
                "(%d marchés). C'est le cas normal depuis les runners GitHub Actions, dont "
                "les IP américaines sont bloquées par les deux plateformes centralisées.",
                ENGINE_NAME, len(hl),
            )
            return hl
        secours = [p.replace("/", "") for p in config.PAIRS]
        logger.warning(
            "[%s] Aucune plateforme joignable : repli sur les %d paires du projet. "
            "Moins de candidats, mais le moteur continue.",
            ENGINE_NAME, len(secours),
        )
        return secours[:taille]

    spots = _lire_json_multi(_MIROIRS_SPOT)
    avec_spot = None
    if spots:
        avec_spot = {
            s["symbol"] for s in spots.get("symbols", [])
            if s.get("status") == "TRADING" and s.get("quoteAsset") == "USDT"
        }
    else:
        logger.warning(
            "[%s] Liste des paires au comptant injoignable : le classement est conservé sans "
            "croisement. Un perpétuel sans spot sera écarté plus tard, faute de prix.",
            ENGINE_NAME,
        )

    candidats = [
        d for d in perps
        if d["symbol"].endswith("USDT")
        and d["symbol"] not in _STABLES
        and (avec_spot is None or d["symbol"] in avec_spot)
    ]
    candidats.sort(key=lambda d: -float(d.get("quoteVolume", 0)))
    return [d["symbol"] for d in candidats[:taille]]


def _funding_binance(symbole: str, jours: int):
    """Binance verse toutes les 8 h : 3 versements par jour."""
    depuis = int((datetime.now(timezone.utc) - timedelta(days=jours + 2)).timestamp() * 1000)
    for base in _ENDPOINTS:
        try:
            lignes = _lire_json(f"{base}?symbol={symbole}&startTime={depuis}&limit=1000")
        except Exception:
            continue
        if lignes:
            taux = [float(l["fundingRate"]) * 100 for l in lignes]
            return sum(taux) / len(taux) * 3
    return None


def _funding_bybit(symbole: str, jours: int):
    """Bybit verse aussi toutes les 8 h."""
    depuis = int((datetime.now(timezone.utc) - timedelta(days=jours + 2)).timestamp() * 1000)
    url = f"{_BYBIT_FUNDING}?category=linear&symbol={symbole}&startTime={depuis}&limit=200"
    data = _lire_json_multi((url,), timeout=20)
    lignes = (data or {}).get("result", {}).get("list", [])
    if not lignes:
        return None
    taux = [float(l["fundingRate"]) * 100 for l in lignes]
    return sum(taux) / len(taux) * 3


def _hyperliquid(payload: dict):
    corps = json.dumps(payload).encode()
    requete = urllib.request.Request(
        _HYPERLIQUID, headers={**_HEADERS, "Content-Type": "application/json"}, data=corps
    )
    with urllib.request.urlopen(requete, timeout=25) as reponse:
        return json.load(reponse)


def _funding_hyperliquid(symbole: str, jours: int):
    """
    Hyperliquid verse toutes les HEURES, pas toutes les 8 heures : le taux
    quotidien se calcule donc sur 24 versements et non 3. Confondre les deux
    diviserait le taux par huit et écarterait toutes les paires au plancher.
    """
    coin = symbole[:-4] if symbole.endswith("USDT") else symbole
    depuis = int((datetime.now(timezone.utc) - timedelta(days=jours + 2)).timestamp() * 1000)
    try:
        lignes = _hyperliquid({"type": "fundingHistory", "coin": coin, "startTime": depuis})
    except Exception:
        return None
    if not lignes:
        return None
    taux = [float(l["fundingRate"]) * 100 for l in lignes]
    return sum(taux) / len(taux) * 24


# Sources de financement, essayées dans l'ordre. Chacune normalise son propre
# rythme de versement et rend un taux en % PAR JOUR.
#
# Pourquoi trois. Binance est bloqué depuis les runners GitHub Actions (451) et
# depuis Cloudflare (403). Bybit l'est aussi : les runners GitHub sont sur des
# IP américaines, et les deux plateformes bloquent les États-Unis. Hyperliquid
# est décentralisé, donc joignable de partout — c'est le seul repli qui tienne
# vraiment, et il est volontairement en dernier parce que ses taux sont les plus
# éloignés de ceux du backtest.
_SOURCES_FUNDING = (
    ("Binance", _funding_binance),
    ("Bybit", _funding_bybit),
    ("Hyperliquid", _funding_hyperliquid),
)


def fetch_funding_daily(symbole: str, jours: int):
    """
    Financement moyen en % PAR JOUR sur les `jours` derniers jours, et le nom de
    la plateforme d'où vient la mesure.

    Le nom compte : les taux diffèrent sensiblement d'une plateforme à l'autre
    (sur BTC, +0,0094 %/jour chez Bybit contre +0,0237 % chez Hyperliquid le
    04/08/2026). L'abonné exécute sur SA plateforme, donc lui annoncer un
    chiffre sans dire où il a été mesuré serait trompeur. Le classement RELATIF
    entre paires, lui, reste bien plus stable que le niveau absolu — c'est ce
    qui rend la sélection valide malgré l'écart.

    Retourne (None, None) si aucune source ne répond : l'absence de donnée ne
    doit jamais être confondue avec un financement nul.
    """
    for nom, recuperer in _SOURCES_FUNDING:
        try:
            taux = recuperer(symbole, jours)
        except Exception:
            continue
        if taux is not None:
            return taux, nom
    return None, None


def format_pair(symbole: str) -> str:
    """
    "BTCUSDT" -> "BTC/USDT". L'univers du carry est construit à partir des
    symboles Binance, mais tout le reste du produit (base, messages, historique
    de l'abonné) utilise la notation avec barre oblique. Convertir ici évite
    d'avoir deux conventions qui cohabitent dans la table `signals`.
    Un symbole déjà au bon format est rendu tel quel.
    """
    if "/" in symbole:
        return symbole
    return f"{symbole[:-4]}/USDT" if symbole.endswith("USDT") else symbole


def fetch_spot_price(symbole: str) -> float | None:
    """
    Dernier prix au comptant. Sert de prix de référence pour dimensionner les
    deux jambes — il n'a aucun rôle de déclenchement, la position étant neutre
    au marché. Retourne None si aucune source ne répond, auquel cas la position
    n'est simplement pas ouverte : mieux vaut un signal en moins qu'un prix
    inventé.
    """
    for base in ("https://api.binance.com", "https://api1.binance.com", "https://data-api.binance.vision"):
        try:
            data = _lire_json(f"{base}/api/v3/ticker/price?symbol={symbole}", timeout=15)
            prix = float(data.get("price", 0))
            if prix > 0:
                return prix
        except Exception:
            continue

    # Repli Bybit, pour la même raison que le financement : Binance est
    # inaccessible depuis les runners GitHub Actions, où ce code tourne.
    try:
        data = _lire_json(f"https://api.bybit.com/v5/market/tickers?category=spot&symbol={symbole}", timeout=15)
        lignes = data.get("result", {}).get("list", [])
        if lignes:
            prix = float(lignes[0].get("lastPrice") or 0)
            if prix > 0:
                return prix
    except Exception:
        pass

    logger.warning("[%s] Prix au comptant indisponible pour %s.", ENGINE_NAME, symbole)
    return None


def classer_paires(taux_par_symbole: dict) -> list:
    """
    Classe les symboles par financement quotidien décroissant, après plancher,
    plafond et espérance annoncée minimale.

    `taux_par_symbole` associe chaque symbole à son taux en % PAR JOUR, déjà
    normalisé selon le rythme de versement de sa plateforme (voir
    fetch_funding_daily). Un symbole sans donnée est écarté plutôt que classé
    au pire rang : le faire figurer serait inventer une information.
    """
    scores = {}
    for symbole, taux in taux_par_symbole.items():
        if taux is None:
            continue
        if taux < config.CARRY_MIN_FUNDING_PCT_PER_DAY:
            continue  # ne couvre même pas ses frais
        if taux > config.CARRY_MAX_FUNDING_PCT_PER_DAY:
            logger.info(
                "[%s] %s écartée : financement de %.4f %%/jour au-dessus du plafond de %.4f. "
                "Un taux extrême signale une manie, pas une bonne affaire — c'est là que se "
                "logent les pertes rares et énormes.",
                ENGINE_NAME, symbole, taux, config.CARRY_MAX_FUNDING_PCT_PER_DAY,
            )
            continue
        # Garde-fou indépendant du plancher : jamais de signal dont le gain
        # ANNONCÉ serait nul ou dérisoire.
        attendu = taux * config.CARRY_HOLD_DAYS - config.CARRY_ROUND_TRIP_COST_PCT
        if attendu < config.CARRY_MIN_EXPECTED_PCT:
            continue
        scores[symbole] = taux
    return sorted(scores.items(), key=lambda kv: -kv[1])


def build_signal(pair: str, prix_spot: float, taux_journalier: float, rang: int,
                 timestamp=None, source: str = "Binance") -> dict:
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
        "pair": format_pair(pair),
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
        "carry_source": source,
    }


def detect_carry_signals(taux_par_symbole: dict, prix_spot: dict,
                         already_open: set = None, places_libres: int = None,
                         timestamp=None, sources: dict = None) -> list:
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

    # Plafond quotidien : le régime permanent ouvre CARRY_MAX_POSITIONS /
    # CARRY_HOLD_DAYS positions par jour, mais un démarrage à froid — ou une
    # reprise après plusieurs jours d'arrêt — voudrait tout ouvrir d'un coup.
    # Pour un canal, trente signaux le même jour puis rien pendant trois
    # semaines est pire que peu de signaux.
    if places_libres > config.CARRY_MAX_NEW_PER_DAY:
        logger.info(
            "[%s] %d places libres, mais au plus %d ouvertures par jour : le carnet se "
            "remplit progressivement au lieu d'arriver en rafale.",
            ENGINE_NAME, places_libres, config.CARRY_MAX_NEW_PER_DAY,
        )
        places_libres = config.CARRY_MAX_NEW_PER_DAY

    classement = classer_paires(taux_par_symbole)
    if not classement:
        logger.info(
            "[%s] Aucune paire ne dépasse le plancher de %.4f %%/jour : le financement "
            "ne couvre nulle part ses frais aujourd'hui, on n'ouvre rien.",
            ENGINE_NAME, config.CARRY_MIN_FUNDING_PCT_PER_DAY,
        )
        return []

    # Les positions ouvertes viennent de la base, donc en notation "BTC/USDT",
    # alors que le classement est construit sur des symboles Binance
    # ("BTCUSDT"). Sans cette normalisation, aucune position ouverte ne serait
    # reconnue et le moteur rouvrirait chaque jour les mêmes paires.
    deja = {format_pair(p) for p in already_open}

    signaux = []
    for rang, (pair, taux) in enumerate(classement, start=1):
        if len(signaux) >= places_libres:
            break
        if format_pair(pair) in deja:
            continue
        prix = prix_spot.get(pair)
        if not prix or prix <= 0:
            logger.warning("[%s] %s : prix spot indisponible, position non ouverte.", ENGINE_NAME, pair)
            continue
        signaux.append(build_signal(pair, prix, taux, rang, timestamp,
                                    source=(sources or {}).get(pair, "Binance")))

    if signaux:
        logger.info(
            "[%s] %d carry(s) ouvert(s) sur %d place(s) libre(s) : %s",
            ENGINE_NAME, len(signaux), places_libres,
            ", ".join(f"{s['pair']} ({s['carry_rate_per_day']:.4f} %/j, "
                      f"attendu {s['carry_expected_pct']:+.2f} %)" for s in signaux),
        )
    return signaux
