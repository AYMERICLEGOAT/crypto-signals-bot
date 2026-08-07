"""
Moteur Momentum 4 heures : le complément de la force relative.

CE QU'IL FAIT, ET POURQUOI IL EST L'INVERSE DES AUTRES.

La force relative achète une continuation et elle est coupée quand le Bitcoin passe
sous sa moyenne 200 jours — soit 41 % du temps. Ce moteur-ci ne travaille QUE
pendant ces périodes-là. C'est son unique raison d'être : combler exactement le
trou que les autres laissent.

Mesuré sur 2023-2026, restreint aux marchés défavorables (backtest_4h) :

    top 2, tenu 3 jours : 1,25 signal/jour | 48,3 % gagnants | +0,805 %

L'espérance décroît régulièrement à mesure qu'on descend le classement
(+0,699 % au top 1, +0,805 % au top 2, +0,576 % au top 5, +0,313 % au top 12) :
le signal est dans le RANG, pas dans le nombre.

C'est la seule chose trouvée en douze approches qui produise ce débit dans le
régime de marché actuel. Le témoin aléatoire est net : p = 0,000, +0,65 %
contre +0,24 % pour un tirage de même densité.

POURQUOI L'AVOIR TESTÉ SI TARD. Les notes du projet portaient l'observation
« la stratégie se dégrade du 1h vers le 4h », et j'en avais conclu que les
unités de temps courtes ne valaient rien. Mais cette mesure avait été faite sur
l'ANCIENNE stratégie, celle dont il a ensuite été prouvé que le sens était
inversé. Une stratégie prise à contresens se dégrade nécessairement quand le
bruit diminue et que le vrai phénomène s'exprime : cette « preuve » disait que
le sens était faux, pas que le 4h était mauvais.

CE MOTEUR EST EN OBSERVATION, ET CE N'EST PAS UNE FORMULE DE STYLE.

L'année par année montre une décroissance monotone :

    2023  +2,06 %    2024  +1,28 %    2025  +0,29 %    2026  -0,53 %

Trois années positives sur quatre, mais la dernière est négative. Deux lectures
sont possibles et quatre ans de données ne permettent pas de trancher : soit un
avantage réel qui s'érode parce que d'autres l'exploitent, soit un avantage qui
n'a jamais existé et dont 2023 était un coup de chance.

D'où trois garde-fous, et non un :

  1. Le moteur est étiqueté « en observation » dans ses signaux, et le canal le
     dit aux abonnés. On ne présente pas comme établi ce qui ne l'est pas.
  2. Le volume est volontairement bridé — top 2, quand top 12 produirait quatre
     fois plus de signaux. Et l'arbitre lui interdit en plus de dépasser deux
     places par jour, quoi qu'il propose : lors du premier passage réel il
     occupait les cinq places du canal, ce qui vidait de son sens l'étiquette
     « en observation ». Prévenir d'un risque qu'on fait courir en totalité ne
     protège personne.
  3. edge_guard.py surveille l'espérance RÉELLEMENT réalisée. Au bout de
     30 trades clôturés, si elle est nettement négative, la génération se
     suspend d'elle-même. C'est le seul juge qui compte au bout du compte : la
     mesure historique dit ce qui s'est passé, pas ce qui se passera.

Module de validation : backtest_4h.py
"""

import logging
from datetime import datetime, timedelta, timezone

import pandas as pd

import config

logger = logging.getLogger(__name__)

ENGINE_NAME = "momentum_4h"

# Bougies de 4 heures : six par jour. Toutes les durées du moteur s'expriment
# en bougies, jamais en jours, pour qu'un changement d'unité de temps ne se
# traduise pas silencieusement par un changement de durée réelle.
BOUGIES_PAR_JOUR = 6


def compute_rsi(closes: pd.Series, periode: int) -> pd.Series:
    """RSI de Wilder sur bougies 4 heures."""
    delta = closes.diff()
    gain = delta.clip(lower=0)
    perte = -delta.clip(upper=0)
    moy_gain = gain.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean()
    moy_perte = perte.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean()
    rs = moy_gain / moy_perte.replace(0, pd.NA)
    return 100 - (100 / (1 + rs))


def compute_atr(df: pd.DataFrame, periode: int = 14) -> float | None:
    if df is None or len(df) < periode + 1:
        return None
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(),
                    (df["low"] - prev).abs()], axis=1).max(axis=1)
    valeur = tr.ewm(alpha=1 / periode, adjust=False, min_periods=periode).mean().iloc[-1]
    return None if pd.isna(valeur) or valeur <= 0 else float(valeur)


def marche_defavorable(btc_4h: pd.DataFrame) -> bool | None:
    """
    Le Bitcoin est-il SOUS sa moyenne 200 jours ? C'est la condition d'activité
    de ce moteur — l'exact inverse de la force relative.

    200 jours valent 1 200 bougies de 4 heures. Retourne None si l'historique
    ne suffit pas à trancher, et l'appelant traite ce cas comme un refus : un
    moteur qui ne sait pas dans quel régime il se trouve ne doit rien émettre,
    puisque tout son avantage mesuré dépend précisément de ce régime.
    """
    besoin = config.RS_TREND_MA_PERIOD * BOUGIES_PAR_JOUR
    if btc_4h is None or len(btc_4h) < besoin:
        return None
    closes = btc_4h["close"]
    moyenne = closes.rolling(besoin).mean().iloc[-1]
    if pd.isna(moyenne) or moyenne <= 0:
        return None
    return bool(closes.iloc[-1] < moyenne)


def classer(candles_4h: dict) -> list:
    """
    Classe les paires par force relative décroissante sur bougies 4 heures.
    Une paire dont l'historique est trop court est écartée plutôt que classée
    au pire rang : la faire figurer serait inventer une information.
    """
    scores = {}
    for pair, df in candles_4h.items():
        if df is None or len(df) < config.M4H_RSI_PERIOD + 5:
            continue
        valeur = compute_rsi(df["close"], config.M4H_RSI_PERIOD).iloc[-1]
        if pd.isna(valeur):
            continue
        scores[pair] = float(valeur)
    return sorted(scores.items(), key=lambda kv: -kv[1])


def build_signal(pair: str, prix: float, valeur_atr: float, rang: int, timestamp=None) -> dict:
    """
    Géométrie alignée sur celle du backtest : stop large à 4 x ATR, sortie
    TEMPORELLE au bout de M4H_HOLD_BOUGIES bougies.

    Les objectifs sont posés aux mêmes multiples que les familles journalières
    (4 / 8 / 12 x ATR) pour que l'abonné reconnaisse le même format d'un moteur
    à l'autre. Ils jalonnent la progression et ne pilotent pas la clôture, qui
    reste la durée — comme pour la force relative.
    """
    maintenant = timestamp or datetime.now(timezone.utc)
    heures = config.M4H_HOLD_BOUGIES * 4
    return {
        "pair": pair,
        "type": "BUY",
        "entry_price": round(prix, 8),
        "stop_loss": round(max(prix - config.M4H_SL_ATR_MULT * valeur_atr, prix * 0.05), 8),
        "take_profit": round(prix + 8.0 * valeur_atr, 8),
        "tp1_price": round(prix + 4.0 * valeur_atr, 8),
        "tp2_price": round(prix + 8.0 * valeur_atr, 8),
        "tp3_price": round(prix + 12.0 * valeur_atr, 8),
        "created_at": maintenant.isoformat(),
        "engine": ENGINE_NAME,
        "hold_until": (maintenant + timedelta(hours=heures)).isoformat(),
        # Métadonnées de journalisation, retirées avant insertion.
        "m4h_rang": rang,
        "m4h_heures": heures,
    }


def detect_momentum_4h_signals(candles_4h: dict, btc_4h: pd.DataFrame,
                               already_open: set = None, timestamp=None) -> list:
    """
    Point d'entrée. N'émet QUE si le marché est défavorable — c'est la seule
    condition dans laquelle l'avantage a été mesuré.
    """
    already_open = already_open or set()

    defavorable = marche_defavorable(btc_4h)
    if defavorable is None:
        logger.warning(
            "[%s] Historique BTC insuffisant pour déterminer le régime : aucun signal. "
            "Tout l'avantage mesuré de ce moteur dépend du régime, on ne devine pas.",
            ENGINE_NAME,
        )
        return []
    if not defavorable:
        logger.info(
            "[%s] Marché favorable : ce moteur se tait, la force relative prend le relais. "
            "Il ne travaille que dans le régime où elle est coupée.",
            ENGINE_NAME,
        )
        return []

    classement = classer(candles_4h)
    if len(classement) < config.M4H_MIN_RANKED_PAIRS:
        logger.warning(
            "[%s] Seulement %d paires classables (%d requises) : classement non fiable.",
            ENGINE_NAME, len(classement), config.M4H_MIN_RANKED_PAIRS,
        )
        return []

    signaux = []
    for rang, (pair, _score) in enumerate(classement, start=1):
        if len(signaux) >= config.M4H_TOP_N:
            break
        if pair in already_open:
            continue
        df = candles_4h[pair]
        valeur_atr = compute_atr(df)
        prix = float(df["close"].iloc[-1])
        if valeur_atr is None or prix <= 0:
            continue
        signaux.append(build_signal(pair, prix, valeur_atr, rang, timestamp))

    if signaux:
        logger.info(
            "[%s] %d signal(aux) EN OBSERVATION : %s. Marché défavorable confirmé, "
            "classement sur %d paires.",
            ENGINE_NAME, len(signaux),
            ", ".join(f"{s['pair']} (#{s['m4h_rang']})" for s in signaux), len(classement),
        )
    return signaux
