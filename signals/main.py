"""
Point d'entrée du module de signaux — exécution UNIQUE (pas de boucle).

Conçu pour tourner via GitHub Actions (.github/workflows/signals.yml,
toutes les heures) : chaque exécution part d'une machine neuve, donc chaque
paire récupère elle-même assez d'historique récent (bougies horaires) pour
recalculer les indicateurs à partir de zéro — aucun état local à faire
survivre entre deux runs (l'ancien cache SQLite local, state_cache.py,
n'a plus lieu d'être et a été retiré).

Étapes par paire :
  1. Récupère les ~100 dernières bougies horaires : Binance en priorité
     (endpoints publics, pas de clé requise), repli CoinGecko si Binance
     est indisponible.
  2. Calcule les indicateurs et détecte un éventuel croisement EMA + RSI.
  3. Si un signal est détecté : génère son graphique, l'envoie sur Supabase
     Storage, puis insère le signal dans la table `signals`.

Les paramètres de stratégie (EMA/RSI) sont chargés depuis la table Supabase
`strategy_params` (dernière ligne is_active=true, écrite par backtest.py),
avec repli sur les valeurs par défaut de config.py si aucune n'existe encore.
"""

import logging
import os
from datetime import datetime, timezone

import pandas as pd

import config
import storage
import params_store
import binance_client
import coingecko_client
import correlation_guard
import momentum
from indicators import compute_all_indicators, ema
from strategy import detect_signal
from confidence import compute_confidence_score
from chart_generator import generate_chart

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Amélioration 9 : porté de 100 à 250 pour que l'EMA200 (composante du score
# de confiance, voir confidence.py) dispose d'assez d'historique pour être
# significative — 100 bougies ne suffisaient qu'à EMA21/RSI14.
KLINES_LOOKBACK = 250
COINGECKO_FALLBACK_DAYS = 6  # granularité horaire chez CoinGecko sur cette fenêtre, ~144 points


def load_active_params() -> dict:
    """Charge les paramètres actifs depuis Supabase, ou les valeurs par défaut de config.py."""
    row = params_store.load_active_params()
    if row:
        logger.info(
            "Paramètres actifs chargés depuis Supabase (source=%s, win_rate=%.1f%%)",
            row.get("source", "?"), float(row.get("global_win_rate", 0)) * 100,
        )
        return {
            "ema_fast": row["ema_fast"],
            "ema_slow": row["ema_slow"],
            "rsi_buy_threshold": row["rsi_buy_threshold"],
            "rsi_sell_threshold": row["rsi_sell_threshold"],
        }
    logger.info("Aucun paramètre actif en base, utilisation des valeurs par défaut de config.py.")
    return {
        "ema_fast": config.EMA_FAST_PERIOD,
        "ema_slow": config.EMA_SLOW_PERIOD,
        "rsi_buy_threshold": config.RSI_BUY_THRESHOLD,
        "rsi_sell_threshold": config.RSI_SELL_THRESHOLD,
    }


def fetch_recent_prices(pair: str, coin_id: str):
    """
    Historique récent d'une paire sous forme de DataFrame (colonnes ts_ms,
    price, high, low). Binance en priorité (bougies horaires réelles, avec
    high/low pour l'ATR des Alertes Momentum — voir momentum.py), repli
    CoinGecko en cas d'échec. Retourne None si les deux échouent.

    Le repli CoinGecko ne fournit que des prix de clôture : high/low sont
    alors égaux à price, ce qui dégrade l'ATR calculé (indicators.atr) en un
    simple écart de clôture à clôture — moins précis qu'un vrai ATR, mais
    reste une mesure honnête de volatilité réelle, pas une donnée inventée.
    """
    symbol = binance_client.pair_to_symbol(pair)
    try:
        candles = binance_client.get_klines(symbol, interval="1h", limit=KLINES_LOOKBACK)
        if candles:
            return pd.DataFrame(
                [(ts, high, low, close) for ts, _open, high, low, close, _vol in candles],
                columns=["ts_ms", "high", "low", "price"],
            )
    except Exception:
        logger.warning("Binance indisponible pour %s, repli sur CoinGecko.", pair, exc_info=True)

    try:
        points = coingecko_client.get_intraday_history(coin_id, days=COINGECKO_FALLBACK_DAYS)
        if points:
            df = pd.DataFrame(points, columns=["ts_ms", "price"])
            df["high"] = df["price"]
            df["low"] = df["price"]
            return df
    except Exception:
        logger.exception("Échec du repli CoinGecko pour %s.", pair)

    return None


def fetch_htf_ema50(pair: str) -> float | None:
    """
    Amélioration 1 (expérimentale, voir config.ENABLE_HTF_FILTER) : EMA50 sur
    le timeframe HTF (4h par défaut), pour confirmer l'alignement de tendance
    avant d'émettre un signal 1h. Retourne None si les données HTF ne sont
    pas disponibles (dégradation silencieuse : le filtre est alors ignoré
    pour cette paire ce cycle plutôt que de bloquer la détection).
    """
    try:
        symbol = binance_client.pair_to_symbol(pair)
        candles = binance_client.get_klines(symbol, interval=config.HTF_INTERVAL, limit=100)
        if len(candles) < config.HTF_EMA_PERIOD:
            return None
        closes = pd.Series([c[4] for c in candles])
        # Dernière bougie 4h déjà CLÔTURÉE (get_klines peut inclure la bougie en
        # cours) : on écarte la plus récente pour ne jamais juger sur un 4h
        # encore incomplet, cohérent avec l'alignement utilisé en backtest.
        return float(ema(closes, config.HTF_EMA_PERIOD).iloc[-2])
    except Exception:
        logger.warning("Échec de récupération de l'EMA%d %s pour %s, filtre HTF ignoré ce cycle.",
                        config.HTF_EMA_PERIOD, config.HTF_INTERVAL, pair, exc_info=True)
        return None


def _generate_and_upload_chart(enriched_df, signal_dict: dict, now_ms: int) -> str | None:
    """
    Génère le graphique du signal et l'envoie vers Supabase Storage.
    Ne bloque jamais l'insertion du signal si ça échoue (graphique manquant
    != signal manquant) : retourne None dans ce cas.
    """
    os.makedirs(config.CHART_TMP_DIR, exist_ok=True)
    pair_slug = signal_dict["pair"].replace("/", "-")
    local_path = os.path.join(config.CHART_TMP_DIR, f"{pair_slug}-{now_ms}.png")
    remote_filename = f"{pair_slug}-{now_ms}.png"

    try:
        generate_chart(enriched_df, signal_dict, local_path)
        return storage.upload_chart(local_path, remote_filename)
    except Exception:
        logger.exception("Échec de la génération du graphique pour %s, signal envoyé sans image.", signal_dict["pair"])
        return None
    finally:
        try:
            if os.path.exists(local_path):
                os.remove(local_path)
        except OSError:
            pass


def run_once(params: dict) -> int:
    """
    Une passe complète sur toutes les paires. Les signaux détectés sont
    d'abord collectés (pas insérés) pour permettre au filtre anti-corrélation
    (voir correlation_guard.py) de les examiner ENSEMBLE avant toute
    écriture : si plus de 50% des paires signalent la même direction en
    moins de 4h, AUCUN de ces signaux n'est inséré et la génération est
    mise en pause 24h. Retourne le nombre de signaux effectivement insérés.

    Les Alertes Momentum (Bloc 3, voir momentum.py) sont calculées à part,
    uniquement pour les paires n'ayant PAS produit de vrai signal ce cycle
    (un vrai signal est déjà plus informatif que l'alerte sur le même
    mouvement) — et ne dépendent pas du filtre anti-corrélation, qui ne
    s'applique qu'aux vrais trades.
    """
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    candidates = []
    momentum_alerts = []
    volatility_suspensions = []

    for pair, coin_id in config.PAIRS.items():
        df = fetch_recent_prices(pair, coin_id)
        if df is None or len(df) < config.MIN_HISTORY_POINTS:
            logger.warning("Historique insuffisant pour %s, ignoré ce cycle.", pair)
            continue

        enriched = compute_all_indicators(
            df, params["ema_fast"], params["ema_slow"],
            config.RSI_PERIOD, config.BOLLINGER_PERIOD, config.BOLLINGER_STD,
        )

        # Bloc 11.3 : marché trop erratique pour émettre un signal ce cycle
        # (un stop/target fixé à l'avance n'a plus vraiment de sens).
        curr_atr, curr_price = enriched.iloc[-1].get("atr"), enriched.iloc[-1]["price"]
        if curr_atr is not None and not pd.isna(curr_atr) and curr_price > 0:
            atr_pct = curr_atr / curr_price
            if atr_pct > config.VOLATILITY_SUSPENSION_ATR_PCT:
                logger.warning(
                    "⏸️ %s : signaux suspendus ce cycle (ATR = %.1f%% du prix > seuil %.0f%%).",
                    pair, atr_pct * 100, config.VOLATILITY_SUSPENSION_ATR_PCT * 100,
                )
                volatility_suspensions.append({"pair": pair, "atr_pct": round(atr_pct, 4)})
                continue

        htf_ema50 = fetch_htf_ema50(pair) if config.ENABLE_HTF_FILTER else None
        signal_dict = detect_signal(
            enriched, pair, params["rsi_buy_threshold"], params["rsi_sell_threshold"],
            htf_ema50=htf_ema50,
        )
        if signal_dict:
            # Amélioration 9 : score de confiance (0-100), purement informatif
            # (voir confidence.py — jamais présenté comme une probabilité de gain).
            signal_dict["confidence_score"] = compute_confidence_score(
                enriched, signal_dict["type"], params["rsi_buy_threshold"], params["rsi_sell_threshold"],
            )
            candidates.append((signal_dict, enriched))
        else:
            momentum_alerts.extend(
                momentum.detect_momentum_alerts(enriched, pair, params["rsi_buy_threshold"], params["rsi_sell_threshold"])
            )

    if momentum_alerts:
        storage.insert_momentum_alerts(momentum_alerts)
        logger.info("%d alerte(s) momentum détectée(s) ce cycle.", len(momentum_alerts))

    if volatility_suspensions:
        storage.insert_volatility_suspensions(volatility_suspensions)

    if not candidates:
        return 0

    if correlation_guard.check_and_maybe_pause([c[0] for c in candidates]):
        logger.warning(
            "🚫 %d signal(aux) détecté(s) mais NON envoyés : mouvement de marché corrélé détecté, "
            "génération mise en pause 24h par sécurité.", len(candidates),
        )
        return 0

    for signal_dict, enriched in candidates:
        signal_dict["chart_url"] = _generate_and_upload_chart(enriched, signal_dict, now_ms)
        storage.insert_signal(signal_dict)

    return len(candidates)


def main():
    logger.info("Exécution unique du module de signaux (%d paires, Binance -> repli CoinGecko).", len(config.PAIRS))

    active_pause = correlation_guard.get_active_pause()
    if active_pause:
        logger.warning(
            "⏸️ Génération de signaux en pause jusqu'à %s (%s).",
            active_pause["resumes_at"], active_pause["reason"],
        )
        storage.record_heartbeat("signals")  # la pause est un état normal, pas une panne
        return

    params = load_active_params()
    signals_found = run_once(params)
    logger.info("Terminé : %d signal(aux) détecté(s) sur ce cycle.", signals_found)
    storage.record_heartbeat("signals")


if __name__ == "__main__":
    main()
