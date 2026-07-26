"""
Backtest de la stratégie sur 24 mois de données réelles Binance (bougies
horaires), sur les 20 paires de config.py (BACKTEST_PAIRS en dérive
directement — modifier config.PAIRS suffit à changer le périmètre testé).

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
from indicators import compute_all_indicators, macd

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BACKTEST_PAIRS = list(config.PAIRS.keys())
INTERVAL = "1h"
# BACKTEST_TRADE_TIMEOUT_DAYS est exprimé en jours (config.py) ; les bougies
# du backtest sont désormais horaires, donc il faut 24x plus de bougies pour
# représenter la même durée réelle.
TIMEOUT_PERIODS = config.BACKTEST_TRADE_TIMEOUT_DAYS * 24

# Bug critique découvert lors de la validation des "Améliorations 1-9" (pas
# la stratégie elle-même, la MESURE) : ema()/ewm() initialise ema_fast et
# ema_slow au premier prix de la fenêtre téléchargée (les deux DÉMARRENT
# égales). Pendant qu'elles divergent depuis ce point de départ commun, un
# "croisement" quasi garanti se produit dans les toutes premières bougies —
# un artefact numérique de démarrage à froid, pas un vrai signal de marché.
# Vérifié empiriquement : sur un run de 365 jours/20 paires, 100% des 47
# trades bruts détectés tombaient dans les 30 premières bougies de CHAQUE
# paire, et zéro sur les ~8700 bougies suivantes -- la totalité des chiffres
# de win rate produits par ce module avant cette correction (y compris ceux
# déjà enregistrés dans Supabase) reposaient donc sur cet artefact, pas sur
# un vrai comportement de la stratégie. main.py (production) n'est PAS
# affecté : il ne vérifie que les deux dernières bougies d'une fenêtre de
# 100, où l'EMA21 a largement eu le temps de converger (poids résiduel du
# démarrage à froid négligeable après ~3x la période). WARMUP_CANDLES aligne
# le backtest sur cette même marge de convergence avant de compter le moindre
# signal.
WARMUP_CANDLES = 100

# Grille de recherche (volontairement restreinte pour rester rapide).
EMA_FAST_CANDIDATES = [8, 9, 12]
EMA_SLOW_CANDIDATES = [21, 26, 34]
RSI_THRESHOLD_CANDIDATES = [(30, 70), (35, 65), (40, 60)]

# En dessous de ce nombre de trades, un taux de réussite (même de 100%) n'est
# pas fiable statistiquement — trop peu d'occurrences pour rien affirmer.
MIN_SIGNIFICANT_TRADES = 15

# Filtre anti-corrélation (même logique que signals/correlation_guard.py, en
# production) : si plus de 70% des paires suivies déclenchent un trade dans
# la même direction en moins de 2h, c'est un mouvement de marché systémique
# (tout corrélé), pas un edge de la stratégie — ces trades sont exclus du
# calcul de performance pour ne pas laisser un seul événement de marché
# dominer artificiellement (à la hausse ou à la baisse) le win rate affiché.
#
# Audit#4 : seuil relevé de 50%->70% et fenêtre réduite de 4h->2h. Avec 50%/4h,
# le filtre excluait la quasi-totalité des trades sur 6 mois (les cryptos
# bougeant naturellement ensemble à un certain degré, même sans événement
# systémique) : sur 27 combinaisons de paramètres testées, AUCUNE n'atteignait
# le seuil de signification (voir MIN_SIGNIFICANT_TRADES). Un seuil plus élevé
# sur une fenêtre plus courte ne retient que les mouvements vraiment massifs et
# quasi simultanés (le cas qu'on cherche réellement à écarter), sans jeter les
# trades juste "un peu corrélés" comme le sont presque tous les mouvements crypto.
CORRELATION_THRESHOLD = 0.7
CORRELATION_WINDOW_MS = 2 * 60 * 60 * 1000


def filter_correlated_trades(trades: list, total_pairs: int) -> list:
    """
    Retire les trades faisant partie d'un cluster corrélé (voir constantes
    ci-dessus). Un trade peut être exclu via plusieurs "ancres" qui se
    chevauchent ; le résultat ne dépend pas de l'ordre de la liste d'entrée.
    """
    if not trades:
        return trades

    sorted_trades = sorted(trades, key=lambda t: t["entered_at"])
    threshold_count = total_pairs * CORRELATION_THRESHOLD
    excluded = set()

    for i, anchor in enumerate(sorted_trades):
        window_end = anchor["entered_at"] + CORRELATION_WINDOW_MS
        cluster = [
            j for j, t in enumerate(sorted_trades)
            if anchor["entered_at"] <= t["entered_at"] <= window_end and t["side"] == anchor["side"]
        ]
        distinct_pairs = {sorted_trades[j]["pair"] for j in cluster}
        if len(distinct_pairs) > threshold_count:
            excluded.update(cluster)

    if excluded:
        logger.info(
            "Filtre anti-corrélation : %d/%d trades exclus (mouvement de marché corrélé détecté).",
            len(excluded), len(sorted_trades),
        )

    return [t for i, t in enumerate(sorted_trades) if i not in excluded]


def detect_btc_crash_windows(btc_df: pd.DataFrame) -> list:
    """
    Amélioration 8 : détecte chaque instant où BTC/USDT chute de plus de
    BTC_CRASH_DROP_PCT par rapport à son plus haut des BTC_CRASH_WINDOW_MS
    précédentes (2h = 2 bougies horaires), et retourne la liste des fenêtres
    de suspension (start_ms, end_ms) de BTC_CRASH_SUSPEND_MS (4h) qui en
    découlent, pour les paires autres que BTC.
    """
    window_candles = max(1, config.BTC_CRASH_WINDOW_MS // (60 * 60 * 1000))
    rolling_max = btc_df["price"].rolling(window_candles + 1, min_periods=1).max()
    drop_pct = (rolling_max - btc_df["price"]) / rolling_max

    windows = []
    for ts_ms, drop in zip(btc_df["ts_ms"], drop_pct):
        if drop > config.BTC_CRASH_DROP_PCT:
            windows.append((int(ts_ms), int(ts_ms) + config.BTC_CRASH_SUSPEND_MS))
    return windows


def apply_btc_crash_filter(trades: list, crash_windows: list) -> list:
    """Retire les signaux ACHAT sur les paires autres que BTC pendant une fenêtre de suspension (Amélioration 8)."""
    if not crash_windows:
        return trades
    kept = []
    for t in trades:
        if t["pair"] != "BTC/USDT" and t["side"] == "BUY" and any(
            start <= t["entered_at"] <= end for start, end in crash_windows
        ):
            continue
        kept.append(t)
    return kept


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


def _simulate_exit(enriched: pd.DataFrame, entry_idx: int, side: str, entry_price: float,
                    stop_loss: float, take_profit: float, timeout_periods: int) -> tuple:
    """
    Factorisé de simulate_trades (utilisé aussi par les signaux de
    continuation, Amélioration 7) : avance bougie par bougie jusqu'au stop,
    au take profit, ou au timeout. Retourne (outcome, exit_price, exit_idx).
    """
    for j in range(entry_idx + 1, min(entry_idx + 1 + timeout_periods, len(enriched))):
        candle = enriched.iloc[j]
        if side == "BUY":
            if candle["low"] <= stop_loss:
                return "LOSS", stop_loss, j
            if candle["high"] >= take_profit:
                return "WIN", take_profit, j
        else:
            if candle["high"] >= stop_loss:
                return "LOSS", stop_loss, j
            if candle["low"] <= take_profit:
                return "WIN", take_profit, j
    exit_idx = min(entry_idx + timeout_periods, len(enriched) - 1)
    return "TIMEOUT", enriched.iloc[exit_idx]["price"], exit_idx


def simulate_trades(df: pd.DataFrame, ema_fast: int, ema_slow: int, rsi_buy: int, rsi_sell: int,
                     pair: str = "", timeout_periods: int = TIMEOUT_PERIODS, htf_ema50=None,
                     volume_sma_period: int | None = None, use_atr_stops: bool = config.ENABLE_ATR_STOPS,
                     rsi_cross_window: int = config.RSI_CROSS_WINDOW,
                     use_macd_filter: bool = config.ENABLE_MACD_FILTER,
                     use_trading_hours_filter: bool = config.ENABLE_TRADING_HOURS_FILTER,
                     use_continuation: bool = config.ENABLE_CONTINUATION_SIGNALS) -> list:
    """
    Détecte les signaux sur le DataFrame enrichi puis simule chaque trade
    bougie par bougie jusqu'à toucher le stop loss, le take profit, ou
    expirer (timeout -> clôture au marché, PnL réel calculé).

    Chaque trade retourné porte aussi entered_at/exited_at (vrais timestamps
    des bougies Binance utilisées) et exit_price — nécessaires pour
    persister des exemples de trades avec de VRAIES dates historiques
    (voir save_backtest_trades), jamais des dates inventées.

    `htf_ema50` (Amélioration 1, expérimental) : Series optionnelle, alignée
    sur l'index de `df`, donnant l'EMA50 4h la plus récente déjà CLÔTURÉE à
    chaque bougie 1h (voir filter_lab.py pour l'alignement — jamais de 4h en
    cours, pour ne pas tricher avec des données futures). Si fournie, un
    signal ACHAT n'est retenu que si le prix 1h est au-dessus, un signal
    VENTE que s'il est en dessous ; sinon comportement inchangé (None).

    `volume_sma_period` (Amélioration 2, expérimental) : si fourni, le signal
    n'est retenu que si le volume de la bougie courante dépasse la moyenne
    mobile du volume sur les `volume_sma_period` bougies précédentes
    (nécessite une colonne "volume" dans `df`).

    `use_atr_stops` (Amélioration 3, expérimental) : si True, remplace les
    pourcentages fixes config.STOP_LOSS_PCT/TAKE_PROFIT_PCT par
    ATR_STOP_MULTIPLIER x ATR / ATR_TARGET_MULTIPLIER x ATR (ATR14, déjà
    calculé par compute_all_indicators si high/low sont présentes). Si l'ATR
    n'est pas encore disponible (période de warm-up), le trade est ignoré
    plutôt que de retomber silencieusement sur les pourcentages fixes.

    `use_macd_filter` (Amélioration 5, expérimental) : si True, un signal
    ACHAT n'est retenu que si l'histogramme MACD(12,26,9) est positif OU en
    train de remonter (curr > prev) ; VENTE que s'il est négatif OU en train
    de redescendre.

    `use_trading_hours_filter` (Amélioration 6, expérimental) : si True,
    aucun signal entre config.QUIET_HOURS_START_UTC et QUIET_HOURS_END_UTC
    (nuit) ni le week-end (samedi/dimanche), sauf volatilité anormalement
    élevée (ATR courant > ATR_ANOMALY_MULTIPLIER x sa moyenne mobile sur
    ATR_ANOMALY_LOOKBACK bougies).
    """
    enriched = compute_all_indicators(
        df, ema_fast, ema_slow, config.RSI_PERIOD, config.BOLLINGER_PERIOD, config.BOLLINGER_STD
    )
    if volume_sma_period is not None:
        enriched["volume_sma"] = enriched["volume"].rolling(volume_sma_period).mean()
    if use_macd_filter:
        _, _, enriched["macd_hist"] = macd(enriched["price"])
    if use_trading_hours_filter:
        enriched["atr_anomaly_avg"] = enriched["atr"].rolling(config.ATR_ANOMALY_LOOKBACK).mean()
    trades = []

    for i in range(WARMUP_CANDLES, len(enriched) - 1):
        prev, curr = enriched.iloc[i - 1], enriched.iloc[i]
        if pd.isna(curr["ema_slow"]) or pd.isna(curr["rsi"]):
            continue

        crossed_up = prev["price"] <= prev["ema_slow"] and curr["price"] > curr["ema_slow"]
        crossed_down = prev["price"] >= prev["ema_slow"] and curr["price"] < curr["ema_slow"]

        # Correctif fondamental (voir config.RSI_CROSS_WINDOW) : RSI en zone
        # extrême dans les rsi_cross_window bougies précédant ET incluant le
        # croisement (jamais après -- uniquement des données déjà connues à
        # l'instant i, pour rester valide en backtest comme en production).
        recent_rsi = enriched["rsi"].iloc[max(0, i - rsi_cross_window):i + 1]

        side = None
        if crossed_up and (recent_rsi < rsi_buy).any():
            side = "BUY"
        elif crossed_down and (recent_rsi > rsi_sell).any():
            side = "SELL"
        if side is None:
            continue

        if use_macd_filter:
            hist, prev_hist = curr["macd_hist"], prev["macd_hist"]
            if pd.isna(hist) or pd.isna(prev_hist):
                continue
            if side == "BUY" and not (hist > 0 or hist > prev_hist):
                continue
            if side == "SELL" and not (hist < 0 or hist < prev_hist):
                continue

        if use_trading_hours_filter:
            ts = pd.Timestamp(int(curr["ts_ms"]), unit="ms", tz="UTC")
            is_quiet_hour = ts.hour >= config.QUIET_HOURS_START_UTC or ts.hour < config.QUIET_HOURS_END_UTC
            is_weekend = ts.weekday() >= 5  # 5=samedi, 6=dimanche
            if is_quiet_hour or is_weekend:
                atr_avg = curr["atr_anomaly_avg"]
                is_anomaly = not pd.isna(atr_avg) and atr_avg > 0 and curr["atr"] > config.ATR_ANOMALY_MULTIPLIER * atr_avg
                if not is_anomaly:
                    continue

        if htf_ema50 is not None:
            htf_val = htf_ema50.iloc[i]
            if pd.isna(htf_val):
                continue
            if side == "BUY" and not (curr["price"] > htf_val):
                continue
            if side == "SELL" and not (curr["price"] < htf_val):
                continue

        if volume_sma_period is not None:
            vol_sma = curr["volume_sma"]
            if pd.isna(vol_sma) or not (curr["volume"] > vol_sma):
                continue

        entry_price = curr["price"]
        if use_atr_stops:
            atr_val = curr.get("atr")
            if atr_val is None or pd.isna(atr_val):
                continue
            stop_dist = config.ATR_STOP_MULTIPLIER * atr_val
            target_dist = config.ATR_TARGET_MULTIPLIER * atr_val
            if side == "BUY":
                stop_loss = entry_price - stop_dist
                take_profit = entry_price + target_dist
            else:
                stop_loss = entry_price + stop_dist
                take_profit = entry_price - target_dist
        elif side == "BUY":
            stop_loss = entry_price * (1 - config.STOP_LOSS_PCT)
            take_profit = entry_price * (1 + config.TAKE_PROFIT_PCT)
        else:
            stop_loss = entry_price * (1 + config.STOP_LOSS_PCT)
            take_profit = entry_price * (1 - config.TAKE_PROFIT_PCT)

        outcome, exit_price, exit_idx = _simulate_exit(
            enriched, i, side, entry_price, stop_loss, take_profit, timeout_periods
        )

        pnl_pct = ((exit_price - entry_price) / entry_price if side == "BUY"
                   else (entry_price - exit_price) / entry_price)

        trades.append({
            "pair": pair,
            "side": side,
            "entry_price": entry_price,
            "exit_price": exit_price,
            "outcome": outcome,
            "pnl_pct": pnl_pct,
            "entered_at": int(curr["ts_ms"]),
            "exited_at": int(enriched.iloc[exit_idx]["ts_ms"]),
        })

        # Amélioration 7 (expérimental) : après un TP touché, surveille la
        # même tendance pendant CONTINUATION_WINDOW_HOURS ; si le prix reste
        # du bon côté de l'EMA lente sur TOUTE la fenêtre, émet un signal de
        # continuation (SL/TP réduits de moitié) à l'issue de cette fenêtre.
        # Jamais plus d'une continuation par trade gagnant (pas de chaîne
        # infinie) et jamais de données futures utilisées avant l'instant
        # où elles seraient réellement connues.
        if use_continuation and outcome == "WIN":
            window_end = min(exit_idx + config.CONTINUATION_WINDOW_HOURS, len(enriched) - 1)
            if window_end > exit_idx:
                window = enriched.iloc[exit_idx:window_end + 1]
                aligned = (
                    (window["price"] > window["ema_slow"]).all() if side == "BUY"
                    else (window["price"] < window["ema_slow"]).all()
                )
                if aligned and not pd.isna(window.iloc[-1]["ema_slow"]):
                    cont_entry_idx = window_end
                    cont_entry_price = enriched.iloc[cont_entry_idx]["price"]
                    cont_stop_dist = (stop_loss - entry_price if side == "SELL" else entry_price - stop_loss)
                    cont_target_dist = (take_profit - entry_price if side == "BUY" else entry_price - take_profit)
                    half_stop, half_target = abs(cont_stop_dist) / 2, abs(cont_target_dist) / 2
                    if side == "BUY":
                        cont_stop_loss, cont_take_profit = cont_entry_price - half_stop, cont_entry_price + half_target
                    else:
                        cont_stop_loss, cont_take_profit = cont_entry_price + half_stop, cont_entry_price - half_target

                    cont_outcome, cont_exit_price, cont_exit_idx = _simulate_exit(
                        enriched, cont_entry_idx, side, cont_entry_price, cont_stop_loss, cont_take_profit, timeout_periods
                    )
                    cont_pnl_pct = ((cont_exit_price - cont_entry_price) / cont_entry_price if side == "BUY"
                                    else (cont_entry_price - cont_exit_price) / cont_entry_price)
                    trades.append({
                        "pair": pair,
                        "side": side,
                        "entry_price": cont_entry_price,
                        "exit_price": cont_exit_price,
                        "outcome": cont_outcome,
                        "pnl_pct": cont_pnl_pct,
                        "entered_at": int(enriched.iloc[cont_entry_idx]["ts_ms"]),
                        "exited_at": int(enriched.iloc[cont_exit_idx]["ts_ms"]),
                        "is_continuation": True,
                    })

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
                all_trades_raw = []
                for pair, df in pair_dfs.items():
                    all_trades_raw.extend(simulate_trades(df, ema_fast, ema_slow, rsi_buy, rsi_sell, pair=pair))

                all_trades = filter_correlated_trades(all_trades_raw, total_pairs=len(pair_dfs))

                if len(all_trades) < MIN_SIGNIFICANT_TRADES:
                    continue

                per_pair = {}
                for pair in pair_dfs:
                    pair_trades = [t for t in all_trades if t["pair"] == pair]
                    per_pair[pair] = {"trades": len(pair_trades), "win_rate": round(win_rate_of(pair_trades), 4)}

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

    default_trades_raw = []
    for pair, df in pair_dfs.items():
        default_trades_raw.extend(simulate_trades(
            df, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
            config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD, pair=pair,
        ))

    default_trades = filter_correlated_trades(default_trades_raw, total_pairs=len(pair_dfs))
    per_pair_default = {}
    for pair in pair_dfs:
        pair_trades = [t for t in default_trades if t["pair"] == pair]
        per_pair_default[pair] = {"trades": len(pair_trades), "win_rate": round(win_rate_of(pair_trades), 4)}

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

    # Ré-simule avec les paramètres RETENUS (par défaut ou grid_search) pour obtenir
    # la liste définitive des trades à afficher comme exemples sur le site — jamais
    # de date inventée, ce sont les vrais timestamps des bougies Binance utilisées.
    # Même filtre anti-corrélation que pour le calcul des stats ci-dessus, pour que
    # les exemples affichés correspondent exactement au win rate annoncé.
    winning_trades_raw = []
    for pair, df in pair_dfs.items():
        winning_trades_raw.extend(simulate_trades(
            df, result["ema_fast"], result["ema_slow"],
            result["rsi_buy_threshold"], result["rsi_sell_threshold"], pair=pair,
        ))
    winning_trades = filter_correlated_trades(winning_trades_raw, total_pairs=len(pair_dfs))
    params_store.save_backtest_trades(winning_trades)
    logger.info("%d trades individuels enregistrés (exemples pour le site, dates réelles).", len(winning_trades))


if __name__ == "__main__":
    main()
