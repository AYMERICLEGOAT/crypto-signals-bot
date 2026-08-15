"""
Moteur Faiblesse 4 heures : la jambe qui manquait au produit.

CE QU'IL FAIT. Il VEND à découvert les deux cryptos les plus faibles du
classement 4 heures, pendant les périodes où le Bitcoin est sous sa moyenne
200 jours. C'est l'exact miroir du momentum 4H, qui achète les plus fortes dans
le même régime.

POURQUOI IL EXISTE.

Le produit était long-only dans un marché qui baisse depuis novembre 2025. Le
momentum 4H achète les plus fortes en marché baissier : il doit vaincre une
dérive de marché contraire. Une vente à découvert a cette même dérive POUR
elle — et le classement transversal, dont l'avantage est déjà démontré à
l'achat, fonctionne dans les deux sens.

Ce n'était pas une intuition. Le dépôt avait déjà mesuré la variante NEUTRE
(long les meilleures + short les pires) à « 18/18 positives, +37,8 %/an,
Sharpe ≈ 1,0 » — et l'avait écartée parce qu'elle demande DEUX jambes
simultanées, ce qu'un particulier n'exécute pas. Une vente sèche n'en demande
qu'une.

MESURE, forme de PRODUCTION (passage quotidien, exclusion des positions déjà
tenues, régime défavorable seul, frais comptés, 730 jours de bougies 4 h) :

                        trades  espérance  gagnants      p    sans le meilleur
    vente top 1           306    +1,100 %    59,8 %   0,000      +1,048 %
    vente top 2           612    +0,920 %    58,8 %   0,000      +0,891 %
    tirage au sort                +0,164 %
    ---------------------------------------------------------------------
    achat top 1 (momentum) 306    +0,237 %    44,8 %   0,010      -0,025 %

Trois propriétés le distinguent de tout ce qui a été testé jusqu'ici :

  1. IL SURVIT AU RETRAIT DE SON MEILLEUR TRADE (+1,048 contre +1,100). C'est
     le test qui a tué le momentum top 2 (-0,081 % sans son meilleur trade) et
     le financement contrarien. Son avantage n'est pas porté par un coup.
  2. SA MÉDIANE EST POSITIVE (+0,758 %), contre -1,18 % pour la jambe longue.
     L'abonné gagne souvent un peu, au lieu de perdre souvent un peu.
  3. 59 % de trades gagnants contre 44 %. Ce n'est pas cosmétique : c'est la
     différence entre un abonné qui tient et un abonné qui part après six
     pertes d'affilée.

Stabilité : 4 trimestres positifs sur 6, et les QUATRE derniers tous positifs.
Les deux négatifs (2025Q1, 2025Q2) portent les plus petits échantillons.

CE QUE CE MOTEUR COÛTE À L'ABONNÉ, et qui doit être dit avant tout chiffre :

  - il faut un compte à terme (perpétuels). C'est UNE jambe avec un stop, donc
    bien plus accessible que le carry qui en demande deux — mais ce n'est pas
    du spot, et une partie des abonnés ne le fera pas ;
  - une vente peut théoriquement perdre SANS BORNE. Le pire trade mesuré a
    perdu 31,7 % ; le stop n'est pas une option, c'est la condition ;
  - un squeeze franchit un stop en une bougie. La taille de position compte
    plus ici que partout ailleurs.

Ces trois points figurent dans chaque message de signal, avant les niveaux.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import pandas as pd

import config
from momentum_4h import BOUGIES_PAR_JOUR, compute_atr, compute_rsi, marche_defavorable

logger = logging.getLogger(__name__)

ENGINE_NAME = "faiblesse_4h"


def classer_faibles(candles_4h: dict) -> list:
    """
    Classe les paires par force relative CROISSANTE : la plus faible d'abord.

    Une paire dont l'historique est trop court est écartée plutôt que classée
    au pire rang — la faire figurer en tête reviendrait à vendre une crypto
    parce qu'on n'a pas ses données, ce qui est l'inverse d'un signal.
    """
    scores = {}
    for pair, df in candles_4h.items():
        if df is None or len(df) < config.F4H_RSI_PERIOD + 5:
            continue
        valeur = compute_rsi(df["close"], config.F4H_RSI_PERIOD).iloc[-1]
        if pd.isna(valeur):
            continue
        scores[pair] = float(valeur)
    return sorted(scores.items(), key=lambda kv: kv[1])


def build_signal(pair: str, prix: float, valeur_atr: float, rang: int, timestamp=None) -> dict:
    """
    Géométrie MIROIR de celle du momentum : tout est retourné.

    Le stop est AU-DESSUS de l'entrée (le risque d'une vente est la hausse) et
    les objectifs EN DESSOUS. Les multiples d'ATR sont identiques à ceux de la
    jambe longue — 4 pour le stop, 4/8/12 pour les objectifs — pour que
    l'abonné reconnaisse le même format d'un moteur à l'autre.

    La sortie reste TEMPORELLE au bout de F4H_HOLD_BOUGIES : c'est la forme
    exacte qui a été mesurée, et les objectifs ne font que jalonner.
    """
    maintenant = timestamp or datetime.now(timezone.utc)
    heures = config.F4H_HOLD_BOUGIES * 4
    return {
        "pair": pair,
        "type": "SELL",
        "entry_price": round(prix, 8),
        # Le stop d'une vente est au-dessus : une hausse est ce qui fait mal.
        "stop_loss": round(prix + config.F4H_SL_ATR_MULT * valeur_atr, 8),
        # Les objectifs descendent. Le plancher à 5 % du prix évite un objectif
        # négatif ou absurde sur un actif très volatil.
        "take_profit": round(max(prix - 8.0 * valeur_atr, prix * 0.05), 8),
        "tp1_price": round(max(prix - 4.0 * valeur_atr, prix * 0.05), 8),
        "tp2_price": round(max(prix - 8.0 * valeur_atr, prix * 0.05), 8),
        "tp3_price": round(max(prix - 12.0 * valeur_atr, prix * 0.05), 8),
        "created_at": maintenant.isoformat(),
        "engine": ENGINE_NAME,
        "hold_until": (maintenant + timedelta(hours=heures)).isoformat(),
        # Métadonnées de journalisation, retirées avant insertion.
        "f4h_rang": rang,
        "f4h_heures": heures,
    }


def detect_faiblesse_4h_signals(candles_4h: dict, btc_4h: pd.DataFrame,
                                already_open: set | None = None, timestamp=None) -> list:
    """
    Point d'entrée. N'émet QUE si le marché est défavorable.

    C'est la même condition que le momentum 4H, et pour la même raison : c'est
    le seul régime dans lequel l'avantage a été mesuré. Vendre à découvert dans
    un marché haussier reviendrait à parier contre la dérive — exactement
    l'erreur symétrique de celle que le filtre de tendance évite à l'achat.
    """
    already_open = already_open or set()

    defavorable = marche_defavorable(btc_4h)
    if defavorable is None:
        logger.warning(
            "[%s] Historique BTC insuffisant pour déterminer le régime : aucun signal. "
            "Tout l'avantage mesuré dépend du régime, on ne le devine pas.",
            ENGINE_NAME,
        )
        return []
    if not defavorable:
        logger.info(
            "[%s] Marché favorable : ce moteur se tait. Vendre à découvert dans un marché "
            "porteur, c'est parier contre la dérive.",
            ENGINE_NAME,
        )
        return []

    classement = classer_faibles(candles_4h)
    if len(classement) < config.F4H_MIN_RANKED_PAIRS:
        logger.warning(
            "[%s] Seulement %d paires classables (%d requises) : classement non fiable.",
            ENGINE_NAME, len(classement), config.F4H_MIN_RANKED_PAIRS,
        )
        return []

    signaux = []
    for rang, (pair, _score) in enumerate(classement, start=1):
        if len(signaux) >= config.F4H_TOP_N:
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
            "[%s] %d vente(s) à découvert : %s. Marché défavorable confirmé, "
            "classement sur %d paires.",
            ENGINE_NAME, len(signaux),
            ", ".join(f"{s['pair']} (#{s['f4h_rang']})" for s in signaux), len(classement),
        )
    return signaux
