"""
Alertes Momentum (Bloc 3) : contenu d'engagement DISTINCT des signaux réels.

Trois déclencheurs indépendants, calculés sur le DataFrame déjà enrichi par
indicators.compute_all_indicators() :

  1. RSI qui sort de la zone neutre (RSI_NEUTRAL_LOW..RSI_NEUTRAL_HIGH) :
     la bougie précédente avait un RSI neutre, la bougie courante en est
     sortie — une tendance commence peut-être à se former, bien avant
     qu'un signal complet (EMA + RSI, voir strategy.detect_signal) ne se
     déclenche.
  2. Croisement EMA SANS confirmation RSI : le prix vient de croiser l'EMA
     lente (même logique que detect_signal), mais le RSI ne confirme pas
     encore le seuil d'achat/vente — exactement le cas qui NE génère PAS
     de signal réel, mais qui reste un événement notable à partager.
  3. Pic d'ATR (volatilité) : l'ATR courant dépasse de plus de
     ATR_SPIKE_THRESHOLD sa valeur d'il y a ATR_LOOKBACK_CANDLES heures,
     alors que ce n'était pas déjà le cas à la bougie précédente (détection
     de la TRANSITION vers le pic, pas de son maintien — sinon la même
     alerte se répéterait à chaque cycle tant que la volatilité reste haute).

Ces alertes n'ont NI stop loss NI take profit (ce ne sont pas des trades) et
sont marquées d'un `kind` distinct pour ne jamais être confondues avec un
vrai signal BUY/SELL côté Worker (voir cron/dispatchMomentumAlerts.ts).
"""

from datetime import datetime, timezone

import pandas as pd

RSI_NEUTRAL_LOW = 45
RSI_NEUTRAL_HIGH = 55
ATR_SPIKE_THRESHOLD = 0.30
ATR_LOOKBACK_CANDLES = 4  # bougies horaires -> fenêtre de 4h


def _build_alert(pair: str, kind: str, detail: str) -> dict:
    return {
        "pair": pair,
        "kind": kind,
        "detail": detail,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def detect_rsi_neutral_exit(df: pd.DataFrame, pair: str, min_points: int = 22) -> dict | None:
    if len(df) < min_points:
        return None
    prev, curr = df.iloc[-2], df.iloc[-1]
    if pd.isna(prev["rsi"]) or pd.isna(curr["rsi"]):
        return None

    was_neutral = RSI_NEUTRAL_LOW <= prev["rsi"] <= RSI_NEUTRAL_HIGH
    now_outside = not (RSI_NEUTRAL_LOW <= curr["rsi"] <= RSI_NEUTRAL_HIGH)
    if not (was_neutral and now_outside):
        return None

    direction = "haussière" if curr["rsi"] > prev["rsi"] else "baissière"
    return _build_alert(pair, "rsi_neutral_exit", f"RSI sort de la zone neutre ({curr['rsi']:.0f}), dynamique {direction}")


def detect_unconfirmed_ema_cross(
    df: pd.DataFrame, pair: str, rsi_buy_threshold: float, rsi_sell_threshold: float, min_points: int = 22
) -> dict | None:
    if len(df) < min_points:
        return None
    prev, curr = df.iloc[-2], df.iloc[-1]
    if pd.isna(prev["ema_slow"]) or pd.isna(curr["ema_slow"]) or pd.isna(curr["rsi"]):
        return None

    crossed_up = prev["price"] <= prev["ema_slow"] and curr["price"] > curr["ema_slow"]
    crossed_down = prev["price"] >= prev["ema_slow"] and curr["price"] < curr["ema_slow"]

    if crossed_up and curr["rsi"] >= rsi_buy_threshold:
        return _build_alert(pair, "ema_cross_unconfirmed", f"Croisement EMA haussier détecté, RSI ({curr['rsi']:.0f}) ne confirme pas encore")
    if crossed_down and curr["rsi"] <= rsi_sell_threshold:
        return _build_alert(pair, "ema_cross_unconfirmed", f"Croisement EMA baissier détecté, RSI ({curr['rsi']:.0f}) ne confirme pas encore")
    return None


def detect_atr_spike(df: pd.DataFrame, pair: str, min_points: int = 22) -> dict | None:
    if "atr" not in df.columns or len(df) < min_points + ATR_LOOKBACK_CANDLES + 1:
        return None

    curr_atr, prev_atr = df["atr"].iloc[-1], df["atr"].iloc[-2]
    curr_past = df["atr"].iloc[-1 - ATR_LOOKBACK_CANDLES]
    prev_past = df["atr"].iloc[-2 - ATR_LOOKBACK_CANDLES]
    if any(pd.isna(v) for v in (curr_atr, prev_atr, curr_past, prev_past)) or curr_past <= 0 or prev_past <= 0:
        return None

    curr_increase = (curr_atr - curr_past) / curr_past
    prev_increase = (prev_atr - prev_past) / prev_past
    if curr_increase < ATR_SPIKE_THRESHOLD or prev_increase >= ATR_SPIKE_THRESHOLD:
        return None  # pas de pic, ou pic déjà signalé au cycle précédent

    return _build_alert(pair, "atr_spike", f"Volatilité en hausse de {curr_increase * 100:.0f}% sur {ATR_LOOKBACK_CANDLES}h")


def detect_momentum_alerts(df: pd.DataFrame, pair: str, rsi_buy_threshold: float, rsi_sell_threshold: float) -> list:
    """
    Retourne 0 à 2 alertes momentum pour cette paire (au plus une sur l'axe
    directionnel RSI/EMA, plus l'ATR qui est un axe indépendant). À appeler
    UNIQUEMENT pour les paires n'ayant pas déjà produit un vrai signal ce
    cycle (voir main.py) : un vrai signal est déjà plus informatif qu'une
    alerte momentum sur le même mouvement.

    Retour terrain (29/07) : RSI-sort-de-la-zone-neutre et croisement-EMA
    décrivent quasi toujours le MÊME mouvement de prix (un croisement EMA
    s'accompagne presque mécaniquement d'un RSI qui change de zone) -- les
    déclencher comme deux alertes séparées produisait deux messages
    consécutifs quasi redondants pour la même paire au même cycle, ressenti
    comme du spam. On fusionne : si les deux se déclenchent ensemble, une
    seule alerte (kind ema_cross_unconfirmed, plus spécifique) avec un détail
    qui mentionne les deux, plutôt que deux messages.
    """
    rsi_alert = detect_rsi_neutral_exit(df, pair)
    ema_alert = detect_unconfirmed_ema_cross(df, pair, rsi_buy_threshold, rsi_sell_threshold)
    atr_alert = detect_atr_spike(df, pair)

    alerts = []
    if rsi_alert and ema_alert:
        ema_alert["detail"] += " (RSI sort aussi de sa zone neutre au même moment)"
        alerts.append(ema_alert)
    elif ema_alert:
        alerts.append(ema_alert)
    elif rsi_alert:
        alerts.append(rsi_alert)
    if atr_alert:
        alerts.append(atr_alert)
    return alerts
