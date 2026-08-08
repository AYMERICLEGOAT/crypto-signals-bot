"""
Deux moteurs journaliers : la cassure de canal, et l'expansion de volatilité.

POURQUOI ILS EXISTENT MAINTENANT ET PAS AVANT.

Le produit ANNONÇAIT ces deux familles publiquement — sur le site, dans /help,
dans les CGV — alors qu'aucun module ne les émettait. Elles avaient été validées
dans backtest_familles.py, mais à l'intérieur d'un portefeuille agrégé et sans
le filtre de tendance : personne ne les avait mesurées seules, dans les
conditions où elles tourneraient. Les textes ont d'abord été corrigés pour
cesser de les annoncer ; restait à savoir si elles méritaient d'être écrites.

LA MESURE, faite avec une barre fixée AVANT de regarder les résultats
(backtest_deux_familles.py) : au moins 60 signaux, espérance positive avec
filtre de tendance, p < 0,05 contre un témoin aléatoire de même densité, et au
moins 4 années positives sur 6.

    cassure de canal      815 signaux | 51,4 % gagnants | +5,689 % | p = 0,000 | 4/5 années +
    expansion de volatilité 210 signaux | 52,4 % gagnants | +5,640 % | p = 0,000 | 4/5 années +

Le témoin est écrasant dans les deux cas : +5,7 % contre +0,9 % pour un tirage
au sort de même densité. Dix approches sur douze ont échoué exactement à cette
étape ; ces deux-là passent sans ambiguïté.

UN POINT DE MÉTHODE QUI A CHANGÉ LES CHIFFRES RETENUS. Ces mesures-là incluent
un stop intrabar, alors que la force relative avait été mesurée sans stop.
Comparer les deux dans l'arbitre reviendrait à comparer deux stratégies
différentes — exactement l'incomparabilité que l'arbitre existe pour supprimer.
Les trois moteurs ont donc été remesurés avec le MÊME protocole (entrée à la
clôture du lendemain, sortie à la clôture après 7 jours, frais déduits, filtre
actif, aucun stop), et ce sont ces chiffres-là qui alimentent signal_arbiter :

    force relative           1,04 sig/j | 47,3 % | +2,275 % | 0,325 %/jour
    cassure de canal         0,32 sig/j | 49,3 % | +4,657 % | 0,665 %/jour
    expansion de volatilité  0,09 sig/j | 51,6 % | +4,992 % | 0,713 %/jour

Les deux nouvelles sont donc plus rentables PAR SIGNAL que la force relative, et
beaucoup plus rares. Elles ne la remplacent pas : elles complètent son débit
avec des entrées plus sélectives.

CE QU'ELLES ONT EN COMMUN. Toutes deux achètent une continuation sur bougies
journalières, sont coupées quand le Bitcoin passe sous sa moyenne 200 jours, et
portent la même géométrie que la force relative : stop large à 4 x ATR, jalons à
4 / 8 / 12 x ATR, sortie TEMPORELLE à 7 jours. Un abonné doit reconnaître le même
format d'un moteur à l'autre — la seule chose qui change est ce qui a déclenché
l'entrée.

Module de validation : backtest_deux_familles.py
"""

import logging
from datetime import datetime, timedelta, timezone

import pandas as pd

import config

logger = logging.getLogger(__name__)

ENGINE_CASSURE = "cassure_canal"
ENGINE_EXPANSION = "expansion_volatilite"


def compute_atr(df: pd.DataFrame, periode: int = 14) -> float | None:
    """ATR de Wilder, dernière valeur. Identique à relative_strength.compute_atr."""
    if df is None or len(df) < periode + 1:
        return None
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(),
                    (df["low"] - prev).abs()], axis=1).max(axis=1)
    valeur = tr.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean().iloc[-1]
    return None if pd.isna(valeur) or valeur <= 0 else float(valeur)


def _serie_atr(df: pd.DataFrame, periode: int) -> pd.Series:
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(),
                    (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean()


def cassure_aujourdhui(df: pd.DataFrame) -> bool:
    """
    La dernière clôture franchit-elle le plus haut des N jours PRÉCÉDENTS ?

    Deux précautions, et chacune corrige une erreur classique :

      - le plus haut est décalé d'un jour (`shift(1)`), sinon la bougie du jour
        se comparerait à elle-même et la condition serait toujours vraie ;
      - la veille ne devait PAS déjà être au-dessus. Sans cette seconde
        condition, une paire qui reste en zone haute redéclencherait un signal
        chaque jour pendant des semaines — on n'achète pas une cassure, on
        achèterait une tendance déjà en place, ce que fait déjà la force
        relative.
    """
    fenetre = config.CASSURE_FENETRE_JOURS
    if df is None or len(df) < fenetre + 5:
        return False
    plus_haut = df["high"].shift(1).rolling(fenetre).max()
    close, close_veille = df["close"].iloc[-1], df["close"].iloc[-2]
    seuil, seuil_veille = plus_haut.iloc[-1], plus_haut.iloc[-2]
    if pd.isna(seuil) or pd.isna(seuil_veille):
        return False
    return bool(close > seuil and close_veille <= seuil_veille)


def expansion_aujourdhui(df: pd.DataFrame) -> bool:
    """
    L'amplitude, longtemps comprimée, se réveille — et la journée est haussière.

    Trois conditions simultanées :
      1. le rapport ATR court / ATR long est resté sous 1 pendant toute la
         période de compression (l'amplitude s'était bien resserrée) ;
      2. il repasse au-dessus de 1 aujourd'hui, et pas avant (le réveil est un
         ÉVÉNEMENT, pas un état) ;
      3. la bougie du jour clôture au-dessus de son ouverture — une expansion
         de volatilité vers le BAS est le contraire d'une opportunité d'achat.
    """
    if df is None or len(df) < config.EXPANSION_COMPRESSION_JOURS + 60:
        return False
    court = _serie_atr(df, config.EXPANSION_ATR_COURT)
    long_ = _serie_atr(df, config.EXPANSION_ATR_LONG)
    ratio = court / long_
    if pd.isna(ratio.iloc[-1]) or pd.isna(ratio.iloc[-2]):
        return False
    comprime = ratio.shift(1).rolling(config.EXPANSION_COMPRESSION_JOURS).max().iloc[-1]
    if pd.isna(comprime) or comprime >= 1.0:
        return False
    reveil = ratio.iloc[-1] > 1.0 and ratio.iloc[-2] <= 1.0
    haussiere = df["close"].iloc[-1] > df["open"].iloc[-1]
    return bool(reveil and haussiere)


def build_signal(pair: str, prix: float, valeur_atr: float, engine: str, timestamp=None) -> dict:
    """
    Même géométrie que la force relative, volontairement.

    Un abonné qui reçoit un signal de cassure et un signal de force relative doit
    lire exactement la même structure : entrée, stop à 4 x ATR, jalons à 4 / 8 /
    12 x ATR, sortie à 7 jours. Seule la raison de l'entrée change, et elle est
    dite dans le message. Inventer une géométrie par moteur obligerait l'abonné à
    réapprendre à lire à chaque fois, pour un gain nul — c'est la même mesure qui
    a validé les trois.
    """
    ouverture = timestamp or datetime.now(timezone.utc)
    return {
        "pair": pair,
        "type": "BUY",
        "entry_price": round(prix, 8),
        "stop_loss": round(max(prix - config.RS_SL_ATR_MULT * valeur_atr, prix * 0.05), 8),
        "take_profit": round(prix + config.RS_TP2_ATR_MULT * valeur_atr, 8),
        "tp1_price": round(prix + config.RS_TP1_ATR_MULT * valeur_atr, 8),
        "tp2_price": round(prix + config.RS_TP2_ATR_MULT * valeur_atr, 8),
        "tp3_price": round(prix + config.RS_TP3_ATR_MULT * valeur_atr, 8),
        "created_at": ouverture.isoformat(),
        "engine": engine,
        "hold_until": (ouverture + timedelta(days=config.RS_HOLD_DAYS)).isoformat(),
    }


def _detecter(daily_by_pair: dict, btc_daily: pd.DataFrame, condition, engine: str,
              plafond: int, already_open: set = None, timestamp=None) -> list:
    """
    Corps commun aux deux moteurs. Ils ne diffèrent que par leur condition de
    déclenchement : tout le reste — filtre de tendance, géométrie, plafond,
    positions déjà ouvertes — est identique, et le dupliquer garantirait que les
    deux copies divergent au premier correctif.
    """
    from relative_strength import is_market_in_uptrend

    already_open = already_open or set()

    favorable = is_market_in_uptrend(btc_daily)
    if favorable is None:
        logger.warning("[%s] Régime indéterminable : aucun signal, on ne devine pas.", engine)
        return []
    if not favorable:
        logger.info("[%s] Marché défavorable : ce moteur se tait, comme la force relative.", engine)
        return []

    signaux = []
    for pair, df in sorted(daily_by_pair.items()):
        if len(signaux) >= plafond:
            break
        if pair in already_open or df is None:
            continue
        try:
            if not condition(df):
                continue
        except Exception:  # noqa: BLE001
            logger.warning("[%s] %s : condition inévaluable, paire ignorée.", engine, pair, exc_info=True)
            continue
        valeur_atr = compute_atr(df)
        prix = float(df["close"].iloc[-1])
        if valeur_atr is None or prix <= 0:
            continue
        signaux.append(build_signal(pair, prix, valeur_atr, engine, timestamp))

    if signaux:
        logger.info("[%s] %d signal(aux) : %s",
                    engine, len(signaux), ", ".join(s["pair"] for s in signaux))
    return signaux


def detect_cassure_signals(daily_by_pair: dict, btc_daily: pd.DataFrame,
                           already_open: set = None, timestamp=None) -> list:
    """Achat sur franchissement du plus haut des N jours précédents."""
    if not config.ENABLE_CASSURE_ENGINE:
        return []
    return _detecter(daily_by_pair, btc_daily, cassure_aujourdhui, ENGINE_CASSURE,
                     config.CASSURE_MAX_PAR_JOUR, already_open, timestamp)


def detect_expansion_signals(daily_by_pair: dict, btc_daily: pd.DataFrame,
                             already_open: set = None, timestamp=None) -> list:
    """Achat sur réveil de volatilité après compression."""
    if not config.ENABLE_EXPANSION_ENGINE:
        return []
    return _detecter(daily_by_pair, btc_daily, expansion_aujourdhui, ENGINE_EXPANSION,
                     config.EXPANSION_MAX_PAR_JOUR, already_open, timestamp)
