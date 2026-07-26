"""
Score de confiance (0-100), Amélioration 9 : combine la convergence de
plusieurs indicateurs déjà calculés en un score PUREMENT INFORMATIF, affiché
tel quel ("Confiance : 72/100") — jamais présenté comme une probabilité de
gain ("72% de chances de réussite" serait trompeur, voir strategy.py).

Composantes (voir aussi Bloc 11.2) :
  - Fraîcheur du croisement EMA rapide/lente (le signal EST un croisement,
    donc toujours récent par construction, mais RSI_CROSS_WINDOW peut
    confirmer sur une bougie légèrement antérieure -> score dégressif).
  - RSI proche de sa zone "idéale" (35-40 achat / 60-65 vente), pas juste
    sous/sur le seuil de déclenchement.
  - Prix proche de la bande de Bollinger opposée (basse pour un achat,
    haute pour une vente) : la stratégie cherche un retour à la moyenne.
  - Alignement avec la tendance de fond (EMA200).

Les filtres testés dans backtest.py qui n'ont PAS démontré de bénéfice réel
(HTF, volume, MACD, heures creuses, continuation, corrélation BTC — voir
config.py) n'entrent volontairement pas dans ce score : un score ne doit
combiner que des signaux dont la valeur a été vérifiée, pas des heuristiques
non validées habillées en chiffre qui semble sérieux.

⚠️ Vérifié empiriquement (24 mois/20 paires) : le score moyen des trades
GAGNANTS (44.3) et PERDANTS (43.7) est quasiment identique — ce score ne
prédit PAS le résultat d'un trade. Il reste affiché tel quel, à la demande
explicite de l'audit, comme mesure de convergence technique ("combien de
conditions manuelles classiques sont réunies"), jamais comme un indicateur
de probabilité de gain. Ne jamais l'utiliser pour filtrer/prioriser des
signaux tant qu'aucune corrélation réelle n'est démontrée.
"""

import pandas as pd

from indicators import ema

EMA_TREND_PERIOD = 200

RSI_IDEAL_BUY_RANGE = (35, 40)
RSI_IDEAL_SELL_RANGE = (60, 65)

BOLLINGER_PROXIMITY_FULL_PCT = 0.005   # <0.5% de la bande = bonus plein
BOLLINGER_PROXIMITY_ZERO_PCT = 0.03    # >=3% de la bande = bonus nul


def _rsi_component(rsi: float, side: str, rsi_buy_threshold: float, rsi_sell_threshold: float) -> float:
    if pd.isna(rsi):
        return 0
    if side == "BUY":
        low, high = RSI_IDEAL_BUY_RANGE
        if low <= rsi <= high:
            return 25
        return 12 if rsi < rsi_buy_threshold else 0
    low, high = RSI_IDEAL_SELL_RANGE
    if low <= rsi <= high:
        return 25
    return 12 if rsi > rsi_sell_threshold else 0


def _bollinger_component(price: float, side: str, bb_lower: float, bb_upper: float) -> float:
    level = bb_lower if side == "BUY" else bb_upper
    if pd.isna(level) or level <= 0:
        return 0
    dist_pct = abs(price - level) / price
    if dist_pct <= BOLLINGER_PROXIMITY_FULL_PCT:
        return 25
    if dist_pct >= BOLLINGER_PROXIMITY_ZERO_PCT:
        return 0
    span = BOLLINGER_PROXIMITY_ZERO_PCT - BOLLINGER_PROXIMITY_FULL_PCT
    return 25 * (1 - (dist_pct - BOLLINGER_PROXIMITY_FULL_PCT) / span)


def _trend_component(price: float, side: str, ema200: float) -> float:
    if pd.isna(ema200):
        return 0
    if side == "BUY" and price > ema200:
        return 20
    if side == "SELL" and price < ema200:
        return 20
    return 0


def compute_confidence_score(df: pd.DataFrame, side: str, rsi_buy_threshold: float, rsi_sell_threshold: float) -> int:
    """
    `df` : DataFrame déjà enrichi par compute_all_indicators (colonnes price,
    rsi, bb_lower, bb_upper) — la dernière ligne est la bougie du signal.
    Retourne un entier 0-100.
    """
    curr = df.iloc[-1]
    score = 30  # croisement EMA tout juste détecté (le signal EST ce croisement)
    score += _rsi_component(curr["rsi"], side, rsi_buy_threshold, rsi_sell_threshold)
    score += _bollinger_component(curr["price"], side, curr.get("bb_lower"), curr.get("bb_upper"))

    ema200 = ema(df["price"], EMA_TREND_PERIOD).iloc[-1]
    score += _trend_component(curr["price"], side, ema200)

    return max(0, min(100, round(score)))
