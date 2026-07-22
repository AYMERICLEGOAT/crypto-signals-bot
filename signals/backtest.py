"""
Backtest de la stratégie sur ~6 mois d'historique (180 jours).

Limite technique importante (API gratuite) : CoinGecko ne fournit des
bougies OHLC en granularité fine (5 min / horaire) que sur une fenêtre
récente. Au-delà de ~90 jours, l'API bascule automatiquement en
granularité JOURNALIÈRE, même sur le plan gratuit. Le backtest 6 mois
tourne donc sur des clôtures journalières (proxy raisonnable pour valider
la logique de la stratégie), alors que le script temps réel (main.py)
travaille lui sur des points ~5 minutes. C'est un compromis assumé pour
rester 100% gratuit — voir le README.

Si le taux de réussite avec les paramètres par défaut est < 60%, ce
script fait une recherche de paramètres (grid search) sur les périodes
d'EMA et les seuils de RSI, et retient la meilleure combinaison trouvée.

⚠️ Important : cette optimisation se fait "in-sample" (sur les mêmes
données qui servent à mesurer la performance). Un taux de réussite élevé
ici ne garantit PAS un taux de réussite identique en conditions réelles
(risque de surapprentissage / overfitting). Valide toujours en paper
trading (signaux réels, sans argent) avant d'engager des fonds.
"""

import json
import logging
import os

import pandas as pd

import config
from coingecko_client import get_ohlc
from indicators import compute_all_indicators

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

OPTIMIZED_PARAMS_PATH = os.path.join(os.path.dirname(__file__), "data", "optimized_params.json")

# Grille de recherche (volontairement restreinte pour rester rapide).
EMA_FAST_CANDIDATES = [8, 9, 12]
EMA_SLOW_CANDIDATES = [21, 26, 34]
RSI_THRESHOLD_CANDIDATES = [(30, 70), (35, 65), (40, 60)]  # (achat <, vente >)


def fetch_all_ohlc(days: int = config.BACKTEST_DAYS) -> dict:
    """Récupère l'historique OHLC de toutes les paires (1 appel HTTP par paire)."""
    pair_dfs = {}
    for pair, coin_id in config.PAIRS.items():
        logger.info("Téléchargement OHLC %s (%s, %s jours)...", pair, coin_id, days)
        candles = get_ohlc(coin_id, days=days)
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price"])
        if df.empty:
            logger.warning("Aucune donnée OHLC pour %s, ignoré.", pair)
            continue
        pair_dfs[pair] = df
    return pair_dfs


def simulate_trades(df: pd.DataFrame, ema_fast: int, ema_slow: int, rsi_buy: int, rsi_sell: int,
                     timeout_days: int = config.BACKTEST_TRADE_TIMEOUT_DAYS) -> list:
    """
    Détecte les signaux sur le DataFrame enrichi puis simule chaque trade
    jour par jour jusqu'à toucher le stop loss, le take profit, ou expirer
    (timeout -> compté comme perte, hypothèse conservatrice).
    """
    enriched = compute_all_indicators(
        df, ema_fast, ema_slow, config.RSI_PERIOD, config.BOLLINGER_PERIOD, config.BOLLINGER_STD
    )
    trades = []

    for i in range(1, len(enriched) - 1):
        prev, curr = enriched.iloc[i - 1], enriched.iloc[i]
        if pd.isna(curr["ema_slow"]) or pd.isna(curr["rsi"]):
            continue

        crossed_up = prev["price"] <= prev["ema_slow"] and curr["price"] > curr["ema_slow"]
        crossed_down = prev["price"] >= prev["ema_slow"] and curr["price"] < curr["ema_slow"]

        side = None
        if crossed_up and curr["rsi"] < rsi_buy:
            side = "BUY"
        elif crossed_down and curr["rsi"] > rsi_sell:
            side = "SELL"
        if side is None:
            continue

        entry_price = curr["price"]
        if side == "BUY":
            stop_loss = entry_price * (1 - config.STOP_LOSS_PCT)
            take_profit = entry_price * (1 + config.TAKE_PROFIT_PCT)
        else:
            stop_loss = entry_price * (1 + config.STOP_LOSS_PCT)
            take_profit = entry_price * (1 - config.TAKE_PROFIT_PCT)

        outcome = "TIMEOUT"
        for j in range(i + 1, min(i + 1 + timeout_days, len(enriched))):
            day = enriched.iloc[j]
            if side == "BUY":
                if day["low"] <= stop_loss:
                    outcome = "LOSS"
                    break
                if day["high"] >= take_profit:
                    outcome = "WIN"
                    break
            else:
                if day["high"] >= stop_loss:
                    outcome = "LOSS"
                    break
                if day["low"] <= take_profit:
                    outcome = "WIN"
                    break

        trades.append({"side": side, "entry_price": entry_price, "outcome": outcome})

    return trades


def win_rate_of(trades: list) -> float:
    if not trades:
        return 0.0
    wins = sum(1 for t in trades if t["outcome"] == "WIN")
    # Les TIMEOUT sont comptés comme des pertes (hypothèse conservatrice).
    return wins / len(trades)


def grid_search(pair_dfs: dict) -> dict:
    """
    Essaie toutes les combinaisons de la grille sur l'ensemble des paires
    (aucun nouvel appel réseau : tout est recalculé localement sur les
    données déjà téléchargées) et retourne la meilleure combinaison
    trouvée + le détail par paire.
    """
    best = None

    for ema_fast in EMA_FAST_CANDIDATES:
        for ema_slow in EMA_SLOW_CANDIDATES:
            if ema_fast >= ema_slow:
                continue
            for rsi_buy, rsi_sell in RSI_THRESHOLD_CANDIDATES:
                all_trades = []
                per_pair = {}
                for pair, df in pair_dfs.items():
                    trades = simulate_trades(df, ema_fast, ema_slow, rsi_buy, rsi_sell)
                    per_pair[pair] = {
                        "trades": len(trades),
                        "win_rate": round(win_rate_of(trades), 4),
                    }
                    all_trades.extend(trades)

                global_win_rate = win_rate_of(all_trades)
                candidate = {
                    "ema_fast": ema_fast,
                    "ema_slow": ema_slow,
                    "rsi_buy_threshold": rsi_buy,
                    "rsi_sell_threshold": rsi_sell,
                    "total_trades": len(all_trades),
                    "global_win_rate": round(global_win_rate, 4),
                    "per_pair": per_pair,
                }

                # On ne retient une combinaison que si elle produit un minimum
                # de trades (sinon un "100% de réussite sur 1 trade" ne veut rien dire).
                if len(all_trades) < 15:
                    continue

                if best is None or candidate["global_win_rate"] > best["global_win_rate"]:
                    best = candidate

    return best


def main():
    pair_dfs = fetch_all_ohlc()
    if not pair_dfs:
        logger.error("Aucune donnée téléchargée, backtest impossible.")
        return

    # 1) On teste d'abord les paramètres par défaut de config.py.
    default_trades = []
    for pair, df in pair_dfs.items():
        default_trades.extend(
            simulate_trades(df, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
                             config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD)
        )
    default_win_rate = win_rate_of(default_trades)
    logger.info("Paramètres par défaut -> %d trades, win rate = %.1f%%",
                len(default_trades), default_win_rate * 100)

    result = {
        "ema_fast": config.EMA_FAST_PERIOD,
        "ema_slow": config.EMA_SLOW_PERIOD,
        "rsi_buy_threshold": config.RSI_BUY_THRESHOLD,
        "rsi_sell_threshold": config.RSI_SELL_THRESHOLD,
        "total_trades": len(default_trades),
        "global_win_rate": round(default_win_rate, 4),
        "source": "default",
    }

    # 2) Si insuffisant, recherche de la meilleure combinaison sur la grille.
    if default_win_rate < config.BACKTEST_TARGET_WIN_RATE:
        logger.info("Win rate par défaut < %.0f%%, lancement de la recherche de paramètres...",
                     config.BACKTEST_TARGET_WIN_RATE * 100)
        best = grid_search(pair_dfs)
        if best and best["global_win_rate"] > default_win_rate:
            best["source"] = "grid_search"
            result = best
            logger.info("Meilleure combinaison trouvée: EMA %s/%s, RSI achat<%s vente>%s -> win rate %.1f%% sur %d trades",
                        best["ema_fast"], best["ema_slow"], best["rsi_buy_threshold"],
                        best["rsi_sell_threshold"], best["global_win_rate"] * 100, best["total_trades"])
        else:
            logger.warning("Aucune combinaison de la grille ne dépasse le win rate par défaut.")

    if result["global_win_rate"] < config.BACKTEST_TARGET_WIN_RATE:
        logger.warning(
            "⚠️ Aucune combinaison testée n'atteint %.0f%% de réussite sur cet historique. "
            "Le script continuera avec la meilleure trouvée (%.1f%%), mais une performance "
            "passée (et a fortiori optimisée in-sample) ne garantit aucun résultat futur.",
            config.BACKTEST_TARGET_WIN_RATE * 100, result["global_win_rate"] * 100,
        )

    os.makedirs(os.path.dirname(OPTIMIZED_PARAMS_PATH), exist_ok=True)
    with open(OPTIMIZED_PARAMS_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    logger.info("Paramètres retenus écrits dans %s", OPTIMIZED_PARAMS_PATH)
    logger.info(
        "Rappel : optimisation in-sample sur données journalières (proxy 6 mois). "
        "Valide en paper trading avant tout usage réel."
    )


if __name__ == "__main__":
    main()
