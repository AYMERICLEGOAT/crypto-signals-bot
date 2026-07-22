"""
Point d'entrée du module de signaux.

Boucle infinie :
  1. Toutes les 5 minutes, récupère le prix courant des 20 paires en un
     seul appel CoinGecko (/simple/price).
  2. Met à jour le cache local SQLite (state_cache.py) -> permet de
     reprendre sans perte après un redémarrage.
  3. Calcule les indicateurs et détecte un éventuel signal par paire.
  4. Insère les signaux détectés dans Supabase.

Arrêt propre : Ctrl+C (SIGINT) ou SIGTERM. Le cache étant persisté à
chaque itération, un redémarrage reprend exactement là où le script
s'était arrêté (pas de recalcul ni de perte d'historique).
"""

import json
import logging
import os
import signal
import time
from datetime import datetime, timezone

import config
import state_cache
import storage
from coingecko_client import get_current_prices, get_intraday_history
from indicators import compute_all_indicators
from strategy import detect_signal
from backtest import OPTIMIZED_PARAMS_PATH
from chart_generator import generate_chart

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

_shutdown_requested = False


def _handle_shutdown(signum, frame):
    global _shutdown_requested
    logger.info("Signal d'arrêt reçu (%s), fin propre en cours...", signum)
    _shutdown_requested = True


def _register_signal_handlers():
    signal.signal(signal.SIGINT, _handle_shutdown)
    # SIGTERM existe sous Windows mais n'est pas toujours délivrable aux
    # processus console ; on l'enregistre quand même pour Linux/Docker.
    try:
        signal.signal(signal.SIGTERM, _handle_shutdown)
    except (AttributeError, ValueError):
        pass


def load_active_params() -> dict:
    """
    Charge les paramètres retenus par le backtest (data/optimized_params.json)
    s'ils existent, sinon retombe sur les valeurs par défaut de config.py.
    """
    if os.path.exists(OPTIMIZED_PARAMS_PATH):
        with open(OPTIMIZED_PARAMS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        logger.info(
            "Paramètres chargés depuis %s (source=%s, win_rate=%.1f%%)",
            OPTIMIZED_PARAMS_PATH, data.get("source", "?"), data.get("global_win_rate", 0) * 100,
        )
        return {
            "ema_fast": data["ema_fast"],
            "ema_slow": data["ema_slow"],
            "rsi_buy_threshold": data["rsi_buy_threshold"],
            "rsi_sell_threshold": data["rsi_sell_threshold"],
        }
    logger.info("Aucun optimized_params.json trouvé, utilisation des valeurs par défaut de config.py.")
    return {
        "ema_fast": config.EMA_FAST_PERIOD,
        "ema_slow": config.EMA_SLOW_PERIOD,
        "rsi_buy_threshold": config.RSI_BUY_THRESHOLD,
        "rsi_sell_threshold": config.RSI_SELL_THRESHOLD,
    }


def bootstrap_history_if_needed():
    """
    Au démarrage, si le cache local d'une paire est trop petit pour
    calculer des indicateurs fiables, on l'amorce avec l'historique
    intrajournalier gratuit de CoinGecko (~5 min sur les dernières 24h).
    """
    for pair, coin_id in config.PAIRS.items():
        if state_cache.count_points(pair) >= config.MIN_HISTORY_POINTS:
            continue
        logger.info("Amorçage de l'historique pour %s...", pair)
        try:
            points = get_intraday_history(coin_id, days=1)
            state_cache.append_prices_bulk(pair, points)
            logger.info("%s: %d points chargés.", pair, len(points))
        except Exception:
            logger.exception("Échec du bootstrap pour %s, on continuera avec la boucle temps réel.", pair)


def run_cycle(params: dict):
    """Une itération complète : fetch -> cache -> indicateurs -> signal -> stockage."""
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    try:
        prices = get_current_prices(list(config.PAIRS.values()))
    except Exception:
        logger.exception("Échec de la récupération des prix, on retentera au prochain cycle.")
        return

    for pair, coin_id in config.PAIRS.items():
        price = prices.get(coin_id)
        if price is None:
            logger.warning("Pas de prix reçu pour %s (%s), ignoré ce cycle.", pair, coin_id)
            continue

        state_cache.append_price(pair, now_ms, price)
        state_cache.trim_history(pair, config.MAX_HISTORY_POINTS)

        df = state_cache.load_history(pair, config.MAX_HISTORY_POINTS)
        if len(df) < config.MIN_HISTORY_POINTS:
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


def main():
    _register_signal_handlers()
    logger.info("Démarrage du module de signaux (%d paires suivies).", len(config.PAIRS))

    params = load_active_params()
    bootstrap_history_if_needed()

    while not _shutdown_requested:
        cycle_start = time.time()
        run_cycle(params)

        elapsed = time.time() - cycle_start
        remaining = max(0.0, config.POLL_INTERVAL_SECONDS - elapsed)
        # On dort par petites tranches pour réagir vite à un signal d'arrêt.
        slept = 0.0
        while slept < remaining and not _shutdown_requested:
            step = min(1.0, remaining - slept)
            time.sleep(step)
            slept += step

    logger.info("Arrêt propre effectué. L'historique local est conservé pour la prochaine exécution.")


if __name__ == "__main__":
    main()
