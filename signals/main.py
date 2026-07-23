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
from indicators import compute_all_indicators
from strategy import detect_signal
from chart_generator import generate_chart

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

KLINES_LOOKBACK = 100  # bougies horaires Binance (largement > MIN_HISTORY_POINTS)
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
    price). Binance en priorité (bougies horaires réelles), repli CoinGecko
    en cas d'échec. Retourne None si les deux échouent.
    """
    symbol = binance_client.pair_to_symbol(pair)
    try:
        candles = binance_client.get_klines(symbol, interval="1h", limit=KLINES_LOOKBACK)
        if candles:
            return pd.DataFrame(
                [(ts, close) for ts, _open, _high, _low, close, _vol in candles],
                columns=["ts_ms", "price"],
            )
    except Exception:
        logger.warning("Binance indisponible pour %s, repli sur CoinGecko.", pair, exc_info=True)

    try:
        points = coingecko_client.get_intraday_history(coin_id, days=COINGECKO_FALLBACK_DAYS)
        if points:
            return pd.DataFrame(points, columns=["ts_ms", "price"])
    except Exception:
        logger.exception("Échec du repli CoinGecko pour %s.", pair)

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
    """Une passe complète sur toutes les paires. Retourne le nombre de signaux détectés."""
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    signals_found = 0

    for pair, coin_id in config.PAIRS.items():
        df = fetch_recent_prices(pair, coin_id)
        if df is None or len(df) < config.MIN_HISTORY_POINTS:
            logger.warning("Historique insuffisant pour %s, ignoré ce cycle.", pair)
            continue

        enriched = compute_all_indicators(
            df, params["ema_fast"], params["ema_slow"],
            config.RSI_PERIOD, config.BOLLINGER_PERIOD, config.BOLLINGER_STD,
        )
        signal_dict = detect_signal(
            enriched, pair, params["rsi_buy_threshold"], params["rsi_sell_threshold"]
        )
        if signal_dict:
            signal_dict["chart_url"] = _generate_and_upload_chart(enriched, signal_dict, now_ms)
            storage.insert_signal(signal_dict)
            signals_found += 1

    return signals_found


def main():
    logger.info("Exécution unique du module de signaux (%d paires, Binance -> repli CoinGecko).", len(config.PAIRS))
    params = load_active_params()
    signals_found = run_once(params)
    logger.info("Terminé : %d signal(aux) détecté(s) sur ce cycle.", signals_found)


if __name__ == "__main__":
    main()
