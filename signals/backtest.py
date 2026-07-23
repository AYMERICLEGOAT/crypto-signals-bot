"""
Backtest de la stratégie sur 6 mois de données réelles Binance (bougies
horaires), pour BTC/USDT et ETH/USDT.

Contrairement à l'ancienne version (CoinGecko, limitée à des clôtures
JOURNALIÈRES au-delà de 90 jours sur le plan gratuit), Binance fournit de
vraies bougies OHLCV horaires sur toute la période, sans limite ni clé API
— la validation porte donc sur la même granularité que celle utilisée en
production par main.py.

Mesure, sur l'ensemble des trades détectés :
  - taux de réussite (win rate)
  - ratio gain/perte (gain moyen des trades gagnants / |perte moyenne| des
    trades perdants)
  - drawdown maximum (pire chute cumulée de l'équité simulée, effet composé)

Si le taux de réussite avec les paramètres par défaut est < 60 %, lance une
recherche de paramètres (grid search) sur les périodes d'EMA et les seuils
de RSI, retient la meilleure combinaison trouvée, et l'enregistre comme
active dans Supabase (table strategy_params) — main.py la charge ensuite
automatiquement à sa prochaine exécution.

⚠️ Important : cette optimisation se fait "in-sample" (sur les mêmes
données qui servent à mesurer la performance). Un taux de réussite élevé
ici ne garantit PAS un taux de réussite identique en conditions réelles
(risque de surapprentissage / overfitting). Valide toujours en paper
trading (signaux réels, sans argent) avant d'engager des fonds.
"""

import logging

import pandas as pd

import config
import binance_client
import params_store
from indicators import compute_all_indicators

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BACKTEST_PAIRS = ["BTC/USDT", "ETH/USDT"]
INTERVAL = "1h"
# BACKTEST_TRADE_TIMEOUT_DAYS est exprimé en jours (config.py) ; les bougies
# du backtest sont désormais horaires, donc il faut 24x plus de bougies pour
# représenter la même durée réelle.
TIMEOUT_PERIODS = config.BACKTEST_TRADE_TIMEOUT_DAYS * 24

# Grille de recherche (volontairement restreinte pour rester rapide).
EMA_FAST_CANDIDATES = [8, 9, 12]
EMA_SLOW_CANDIDATES = [21, 26, 34]
RSI_THRESHOLD_CANDIDATES = [(30, 70), (35, 65), (40, 60)]

# En dessous de ce nombre de trades, un taux de réussite (même de 100%) n'est
# pas fiable statistiquement — trop peu d'occurrences pour rien affirmer.
MIN_SIGNIFICANT_TRADES = 15


def fetch_all_klines(pairs=BACKTEST_PAIRS, days=config.BACKTEST_DAYS) -> dict:
    """Récupère l'historique horaire Binance de chaque paire (~180 jours)."""
    pair_dfs = {}
    for pair in pairs:
        symbol = binance_client.pair_to_symbol(pair)
        logger.info("Téléchargement des bougies horaires %s (%s, %d jours)...", pair, symbol, days)
        candles = binance_client.get_historical_klines(symbol, interval=INTERVAL, days=days)
        if not candles:
            logger.warning("Aucune donnée Binance pour %s, ignoré.", pair)
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
        pair_dfs[pair] = df
        logger.info("%s: %d bougies téléchargées.", pair, len(df))
    return pair_dfs


def simulate_trades(df: pd.DataFrame, ema_fast: int, ema_slow: int, rsi_buy: int, rsi_sell: int,
                     timeout_periods: int = TIMEOUT_PERIODS) -> list:
    """
    Détecte les signaux sur le DataFrame enrichi puis simule chaque trade
    bougie par bougie jusqu'à toucher le stop loss, le take profit, ou
    expirer (timeout -> clôture au marché, PnL réel calculé).
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

        outcome, exit_price = "TIMEOUT", None
        for j in range(i + 1, min(i + 1 + timeout_periods, len(enriched))):
            candle = enriched.iloc[j]
            if side == "BUY":
                if candle["low"] <= stop_loss:
                    outcome, exit_price = "LOSS", stop_loss
                    break
                if candle["high"] >= take_profit:
                    outcome, exit_price = "WIN", take_profit
                    break
            else:
                if candle["high"] >= stop_loss:
                    outcome, exit_price = "LOSS", stop_loss
                    break
                if candle["low"] <= take_profit:
                    outcome, exit_price = "WIN", take_profit
                    break

        if exit_price is None:
            last_idx = min(i + timeout_periods, len(enriched) - 1)
            exit_price = enriched.iloc[last_idx]["price"]

        pnl_pct = ((exit_price - entry_price) / entry_price if side == "BUY"
                   else (entry_price - exit_price) / entry_price)

        trades.append({"side": side, "entry_price": entry_price, "outcome": outcome, "pnl_pct": pnl_pct})

    return trades


def win_rate_of(trades: list) -> float:
    if not trades:
        return 0.0
    wins = sum(1 for t in trades if t["outcome"] == "WIN")
    # Les TIMEOUT comptent comme des pertes pour le taux de réussite (hypothèse
    # conservatrice), même si leur pnl_pct réel peut être légèrement positif.
    return wins / len(trades)


def gain_loss_ratio_of(trades: list):
    """Gain moyen des trades en PnL positif / |perte moyenne| des trades en PnL négatif ou nul."""
    gains = [t["pnl_pct"] for t in trades if t["pnl_pct"] > 0]
    losses = [t["pnl_pct"] for t in trades if t["pnl_pct"] <= 0]
    if not gains or not losses:
        return None
    avg_gain = sum(gains) / len(gains)
    avg_loss = abs(sum(losses) / len(losses))
    return avg_gain / avg_loss if avg_loss > 0 else None


def max_drawdown_of(trades: list) -> float:
    """
    Pire chute cumulée de l'équité simulée (trades appliqués dans l'ordre
    chronologique, effet composé, capital de départ = 1.0). Retourne un
    pourcentage positif (0 = jamais de recul, 50 = l'équité a été divisée
    par 2 à un moment donné).
    """
    equity, peak, max_dd = 1.0, 1.0, 0.0
    for t in trades:
        equity *= (1 + t["pnl_pct"])
        peak = max(peak, equity)
        max_dd = max(max_dd, (peak - equity) / peak)
    return max_dd * 100


def grid_search(pair_dfs: dict) -> dict:
    """
    Essaie toutes les combinaisons de la grille sur l'ensemble des paires
    (aucun nouvel appel réseau : tout est recalculé localement sur les
    données déjà téléchargées) et retourne la meilleure combinaison trouvée
    (win rate le plus élevé, avec un minimum de trades pour que le chiffre
    soit significatif).
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
                    per_pair[pair] = {"trades": len(trades), "win_rate": round(win_rate_of(trades), 4)}
                    all_trades.extend(trades)

                if len(all_trades) < 15:
                    continue

                global_win_rate = win_rate_of(all_trades)
                candidate = {
                    "ema_fast": ema_fast,
                    "ema_slow": ema_slow,
                    "rsi_buy_threshold": rsi_buy,
                    "rsi_sell_threshold": rsi_sell,
                    "total_trades": len(all_trades),
                    "global_win_rate": round(global_win_rate, 4),
                    "gain_loss_ratio": gain_loss_ratio_of(all_trades),
                    "max_drawdown_pct": round(max_drawdown_of(all_trades), 2),
                    "per_pair": per_pair,
                }

                if best is None or candidate["global_win_rate"] > best["global_win_rate"]:
                    best = candidate

    return best


def main():
    pair_dfs = fetch_all_klines()
    if not pair_dfs:
        logger.error("Aucune donnée téléchargée, backtest impossible.")
        return

    default_trades = []
    per_pair_default = {}
    for pair, df in pair_dfs.items():
        trades = simulate_trades(df, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
                                  config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD)
        per_pair_default[pair] = {"trades": len(trades), "win_rate": round(win_rate_of(trades), 4)}
        default_trades.extend(trades)

    default_win_rate = win_rate_of(default_trades)
    default_gl_ratio = gain_loss_ratio_of(default_trades)
    default_drawdown = max_drawdown_of(default_trades)

    logger.info(
        "Paramètres par défaut (EMA %d/%d, RSI %d/%d) -> %d trades, win rate = %.1f%%, "
        "ratio gain/perte = %s, drawdown max = %.1f%%",
        config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD, config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD,
        len(default_trades), default_win_rate * 100,
        f"{default_gl_ratio:.2f}" if default_gl_ratio else "n/a", default_drawdown,
    )
    for pair, stats in per_pair_default.items():
        logger.info("  %s: %d trades, win rate %.1f%%", pair, stats["trades"], stats["win_rate"] * 100)

    result = {
        "ema_fast": config.EMA_FAST_PERIOD,
        "ema_slow": config.EMA_SLOW_PERIOD,
        "rsi_buy_threshold": config.RSI_BUY_THRESHOLD,
        "rsi_sell_threshold": config.RSI_SELL_THRESHOLD,
        "total_trades": len(default_trades),
        "global_win_rate": round(default_win_rate, 4),
        "gain_loss_ratio": round(default_gl_ratio, 4) if default_gl_ratio else None,
        "max_drawdown_pct": round(default_drawdown, 2),
        "source": "default",
    }

    default_significant = len(default_trades) >= MIN_SIGNIFICANT_TRADES
    needs_search = (not default_significant) or (default_win_rate < config.BACKTEST_TARGET_WIN_RATE)

    if needs_search:
        reasons = []
        if not default_significant:
            reasons.append(f"seulement {len(default_trades)} trades (< {MIN_SIGNIFICANT_TRADES}, échantillon non significatif)")
        if default_win_rate < config.BACKTEST_TARGET_WIN_RATE:
            reasons.append(f"win rate {default_win_rate * 100:.1f}% < {config.BACKTEST_TARGET_WIN_RATE * 100:.0f}%")
        logger.info("Lancement de la recherche de paramètres (%s)...", "; ".join(reasons))

        best = grid_search(pair_dfs)  # ne retient déjà que les combinaisons avec >= 15 trades
        if best and (not default_significant or best["global_win_rate"] > default_win_rate):
            best["source"] = "grid_search"
            best.pop("per_pair", None)
            result = best
            logger.info(
                "Meilleure combinaison trouvée: EMA %s/%s, RSI achat<%s vente>%s -> win rate %.1f%%, "
                "ratio gain/perte %s, drawdown max %.1f%% sur %d trades",
                best["ema_fast"], best["ema_slow"], best["rsi_buy_threshold"], best["rsi_sell_threshold"],
                best["global_win_rate"] * 100,
                f"{best['gain_loss_ratio']:.2f}" if best.get("gain_loss_ratio") else "n/a",
                best["max_drawdown_pct"], best["total_trades"],
            )
        else:
            logger.warning(
                "Aucune combinaison de la grille n'améliore sur les paramètres par défaut "
                "(ou n'atteint un échantillon significatif) — conservation des paramètres par défaut."
            )

    if result["total_trades"] < MIN_SIGNIFICANT_TRADES:
        logger.warning(
            "⚠️ Échantillon final NON significatif : %d trades sur %d jours (BTC/ETH). Le taux de réussite "
            "de %.1f%% n'est pas fiable statistiquement (trop peu d'occurrences). Les paramètres seront quand "
            "même enregistrés comme actifs, mais une validation sur davantage de paires et/ou une période plus "
            "longue est recommandée avant tout usage réel — ne pas se fier à ce chiffre seul.",
            result["total_trades"], config.BACKTEST_DAYS, result["global_win_rate"] * 100,
        )
    elif result["global_win_rate"] < config.BACKTEST_TARGET_WIN_RATE:
        logger.warning(
            "⚠️ Aucune combinaison testée n'atteint %.0f%% de réussite sur cet historique. "
            "Les paramètres retenus (%.1f%%) seront quand même enregistrés comme actifs, mais une "
            "performance passée (et a fortiori optimisée in-sample) ne garantit aucun résultat futur.",
            config.BACKTEST_TARGET_WIN_RATE * 100, result["global_win_rate"] * 100,
        )

    params_store.save_params(result, pairs_tested=list(pair_dfs.keys()))
    logger.info(
        "Paramètres retenus enregistrés comme actifs dans Supabase (strategy_params). "
        "Rappel : optimisation in-sample — valide en paper trading avant tout usage réel."
    )


if __name__ == "__main__":
    main()
