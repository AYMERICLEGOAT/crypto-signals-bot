"""
Score de confiance (0-100), Amélioration 9 / ÉTAPE 4 : combine la
convergence de plusieurs indicateurs déjà calculés en un score PUREMENT
INFORMATIF, affiché tel quel ("Confiance : 72/100") — jamais présenté comme
une probabilité de gain ("72% de chances de réussite" serait trompeur, voir
strategy.py).

Composantes :
  - Fraîcheur du croisement EMA rapide/lente (le signal EST ce croisement).
  - RSI proche de sa zone "idéale" (35-40 achat / 60-65 vente).
  - Prix proche de la bande de Bollinger opposée (retour à la moyenne).
  - Alignement avec la tendance de fond (EMA200).
  - Volume de la bougie > moyenne mobile 20 bougies.
  - ATR courant pas en pic anormal (mouvement plus "lisible").
  - Proximité d'un support/résistance récent (pivots, voir indicators.pivot_levels).

⚠️ ÉTAPE 4 (score étendu, testé empiriquement sur 12 mois/20 paires,
365j) : score moyen des trades GAGNANTS = 72.3, PERDANTS = 71.1 — écart
négligeable. Le taux de réussite est quasi identique entre les tranches
40-70 (35.0%) et >70 (35.9%). AUCUNE des composantes ci-dessus, seule ou
combinée, ne prédit le résultat d'un trade dans cette stratégie.

Conséquence directe : ÉTAPE 4 demandait de ne PAS envoyer les signaux
sous 40 et d'étiqueter 40-70 "Opportunité" / >70 "Haute confiance" pour
"maximiser le win rate des signaux envoyés". Volontairement PAS implémenté
tel quel : avec un win rate identique entre les deux tranches, cette
étiquette créerait une hiérarchie de qualité fictive entre des signaux
statistiquement équivalents — trompeur pour les abonnés, contraire à la
transparence du projet. Le score reste donc purement informatif ("combien
de conditions techniques classiques convergent"), sans gating ni tiers.
Ne jamais l'utiliser pour filtrer/prioriser des signaux tant qu'une
corrélation réelle n'est démontrée par un futur backtest.
"""

import pandas as pd

from indicators import ema, pivot_levels, nearest_level_distance_pct

EMA_TREND_PERIOD = 200
PIVOT_LOOKBACK = 50

RSI_IDEAL_BUY_RANGE = (35, 40)
RSI_IDEAL_SELL_RANGE = (60, 65)

BOLLINGER_PROXIMITY_FULL_PCT = 0.005   # <0.5% de la bande = bonus plein
BOLLINGER_PROXIMITY_ZERO_PCT = 0.03    # >=3% de la bande = bonus nul

VOLUME_SMA_PERIOD = 20
ATR_AVG_PERIOD = 24
ATR_SPIKE_MULTIPLIER = 1.3
SUPPORT_RESISTANCE_PROXIMITY_PCT = 0.01


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


def _volume_component(volume: float, volume_sma: float) -> float:
    if pd.isna(volume_sma) or volume_sma <= 0 or pd.isna(volume):
        return 0
    return 10 if volume > volume_sma else 0


def _atr_component(atr_val: float, atr_avg: float) -> float:
    if pd.isna(atr_val) or pd.isna(atr_avg) or atr_avg <= 0:
        return 0
    return 10 if atr_val <= ATR_SPIKE_MULTIPLIER * atr_avg else 0


def _support_resistance_component(price: float, df: pd.DataFrame) -> float:
    if len(df) <= PIVOT_LOOKBACK:
        return 0
    window = df.iloc[-PIVOT_LOOKBACK - 1:-1]  # exclut la bougie courante (pas de fuite)
    highs, lows = pivot_levels(window, lookback=PIVOT_LOOKBACK, order=5)
    dist = nearest_level_distance_pct(price, highs + lows)
    if dist is None:
        return 0
    return 15 if dist <= SUPPORT_RESISTANCE_PROXIMITY_PCT else 0


def compute_confidence_score(df: pd.DataFrame, side: str, rsi_buy_threshold: float, rsi_sell_threshold: float) -> int:
    """
    `df` : DataFrame déjà enrichi par compute_all_indicators (colonnes price,
    rsi, bb_lower, bb_upper, atr, volume, high, low) — la dernière ligne est
    la bougie du signal. Retourne un entier 0-100 (purement informatif, voir
    docstring du module).
    """
    curr = df.iloc[-1]
    score = 30  # croisement EMA tout juste détecté (le signal EST ce croisement)
    score += _rsi_component(curr["rsi"], side, rsi_buy_threshold, rsi_sell_threshold)
    score += _bollinger_component(curr["price"], side, curr.get("bb_lower"), curr.get("bb_upper"))

    ema200 = ema(df["price"], EMA_TREND_PERIOD).iloc[-1]
    score += _trend_component(curr["price"], side, ema200)

    if "volume" in df.columns:
        volume_sma = df["volume"].rolling(VOLUME_SMA_PERIOD).mean().iloc[-1]
        score += _volume_component(curr["volume"], volume_sma)

    if "atr" in df.columns:
        atr_avg = df["atr"].rolling(ATR_AVG_PERIOD).mean().iloc[-1]
        score += _atr_component(curr.get("atr"), atr_avg)

    score += _support_resistance_component(curr["price"], df)

    return max(0, min(100, round(score)))
