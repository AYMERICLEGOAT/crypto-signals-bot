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
import coinbase_client
import kraken_client
import correlation_guard
import edge_guard
import momentum
import alerts
from indicators import compute_all_indicators, ema
from strategy import detect_signals_with_catchup, is_still_actionable
from squeeze_engine import detect_squeeze_signal
from relative_strength import detect_relative_strength_signals
from confidence import compute_confidence_score
from chart_generator import generate_chart

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

# Amélioration 9 : porté de 100 à 250 pour que l'EMA200 (composante du score
# de confiance, voir confidence.py) dispose d'assez d'historique pour être
# significative — 100 bougies ne suffisaient qu'à EMA21/RSI14.
KLINES_LOOKBACK = 250
COINGECKO_FALLBACK_DAYS = 6  # granularité horaire chez CoinGecko sur cette fenêtre, ~144 points


def only_closed_candles(df: pd.DataFrame, interval_ms: int) -> pd.DataFrame:
    """Exclut la bougie ouverte : un croisement provisoire n'est jamais un signal."""
    if df.empty:
        return df
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    return df[df["ts_ms"] + interval_ms <= now_ms].reset_index(drop=True)


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
    price, high, low, volume). Source hybride à 4 niveaux, chacun tenté
    seulement si le précédent échoue :
      1. Binance — bougies horaires réelles (high/low pour l'ATR des
         Alertes Momentum, voir momentum.py ; volume pour le score de
         confiance, voir confidence.py). En pratique geo-bloquée (451)
         depuis les runners GitHub Actions, donc quasi toujours absente.
      2. Coinbase Exchange — vraies bougies OHLCV (comme Binance), couverture
         à 100% de l'univers de paires (mapping BASE-USD trivial).
      3. Kraken — deuxième repli à données réelles.
      4. CoinGecko — dernier recours SEULEMENT (30/07) : ne fournit que des
         prix de clôture (high/low dégradés à price, volume à 0) ET impose
         un throttle de 12s/appel (plan gratuit, 5 appels/min, voir
         COINGECKO_MAX_CALLS_PER_MINUTE) -- décisif sur 40 paires : passé en
         2e position, Binance étant systématiquement bloqué en production,
         CHAQUE cycle payait 40x12s = 8 min de latence pure. Combiné à la
         garde anti-chevauchement du workflow (cancel-in-progress=false),
         ça faisait sauter la moitié des déclenchements horaires -- une
         bougie où un croisement EMA se produisait n'était alors plus la
         bougie "courante" au prochain cycle (retardé), et detect_signal()
         ne regarde jamais que la dernière bougie : le signal était
         définitivement raté, pas juste retardé. Coinbase/Kraken n'ont pas
         ce throttle et donnent une vraie donnée OHLCV, d'où leur promotion
         devant CoinGecko.
    Retourne None si les 4 échouent (la paire est ignorée ce cycle, voir
    run_once, et compte comme un échec dans le suivi de panne totale).
    """
    symbol = binance_client.pair_to_symbol(pair)
    try:
        candles = binance_client.get_klines(symbol, interval="1h", limit=KLINES_LOOKBACK)
        if candles:
            return pd.DataFrame(
                [(ts, high, low, close, vol) for ts, _open, high, low, close, vol in candles],
                columns=["ts_ms", "high", "low", "price", "volume"],
            )
    except Exception:
        logger.warning("Binance indisponible pour %s, repli sur Coinbase Exchange.", pair, exc_info=True)

    try:
        candles = coinbase_client.get_klines(pair, limit=KLINES_LOOKBACK)
        if candles:
            return pd.DataFrame(
                [(ts, high, low, close, vol) for ts, _open, high, low, close, vol in candles],
                columns=["ts_ms", "high", "low", "price", "volume"],
            )
    except Exception:
        logger.warning("Échec du repli Coinbase Exchange pour %s, tentative Kraken.", pair, exc_info=True)

    try:
        candles = kraken_client.get_klines(pair, limit=KLINES_LOOKBACK)
        if candles:
            return pd.DataFrame(
                [(ts, high, low, close, vol) for ts, _open, high, low, close, vol in candles],
                columns=["ts_ms", "high", "low", "price", "volume"],
            )
    except Exception:
        logger.warning("Échec du repli Kraken pour %s, dernière tentative sur CoinGecko.", pair, exc_info=True)

    try:
        points = coingecko_client.get_intraday_history(coin_id, days=COINGECKO_FALLBACK_DAYS)
        if points:
            df = pd.DataFrame(points, columns=["ts_ms", "price"])
            df["high"] = df["price"]
            df["low"] = df["price"]
            df["volume"] = 0.0
            return df
    except Exception:
        logger.exception("Échec du repli CoinGecko pour %s -- les 4 sources ont échoué ce cycle pour cette paire.", pair)

    return None


def fetch_recent_prices_15m(pair: str):
    """
    Historique 15 minutes pour le moteur ⚡ Squeeze (voir squeeze_engine.py).
    CoinGecko est exclu de cette cascade (contrairement à fetch_recent_prices
    ci-dessus) : son endpoint intraday ne fournit ni volume ni high/low, deux
    entrées requises par la détection squeeze/ATR -- inutile d'y recourir.
    Binance -> Coinbase Exchange -> Kraken (dernier repli).
    """
    symbol = binance_client.pair_to_symbol(pair)
    try:
        candles = binance_client.get_klines(symbol, interval="15m", limit=config.SQUEEZE_KLINES_LOOKBACK)
        if candles:
            return pd.DataFrame(
                [(ts, high, low, close, vol) for ts, _open, high, low, close, vol in candles],
                columns=["ts_ms", "high", "low", "price", "volume"],
            )
    except Exception:
        logger.warning("Binance (15m) indisponible pour %s, repli sur Coinbase Exchange.", pair, exc_info=True)

    try:
        candles = coinbase_client.get_klines(pair, limit=config.SQUEEZE_KLINES_LOOKBACK, granularity_seconds=900)
        if candles:
            return pd.DataFrame(
                [(ts, high, low, close, vol) for ts, _open, high, low, close, vol in candles],
                columns=["ts_ms", "high", "low", "price", "volume"],
            )
    except Exception:
        logger.warning("Échec du repli Coinbase Exchange (15m) pour %s, dernière tentative sur Kraken.", pair, exc_info=True)

    try:
        candles = kraken_client.get_klines(pair, limit=config.SQUEEZE_KLINES_LOOKBACK, interval_minutes=15)
        if candles:
            return pd.DataFrame(
                [(ts, high, low, close, vol) for ts, _open, high, low, close, vol in candles],
                columns=["ts_ms", "high", "low", "price", "volume"],
            )
    except Exception:
        logger.exception("Échec du repli Kraken (15m) pour %s -- les 3 sources ont échoué ce cycle pour cette paire.", pair)

    return None


def fetch_daily_candles(pair: str):
    """
    Bougies JOURNALIÈRES pour le moteur Force Relative (relative_strength.py).

    Aucun repli sur les autres sources, contrairement aux fetchers horaires.
    C'est délibéré : ce moteur classe les paires les unes CONTRE les autres, et
    mélanger des clôtures Binance avec des clôtures Coinbase ou Kraken — qui
    n'ont ni le même instant de découpe ni exactement le même prix — fausserait
    le classement lui-même. Mieux vaut une paire absente du classement qu'une
    paire mal classée. Si Binance est indisponible, le moteur ne tourne pas ce
    jour-là, ce que le seuil RS_MIN_RANKED_PAIRS garantit.
    """
    symbol = binance_client.pair_to_symbol(pair)
    try:
        candles = binance_client.get_klines(symbol, interval="1d", limit=KLINES_LOOKBACK)
    except Exception:
        logger.warning("Binance (1d) indisponible pour %s : paire exclue du classement.", pair, exc_info=True)
        return None
    if not candles:
        return None
    df = pd.DataFrame(
        [(ts, o, high, low, close) for ts, o, high, low, close, _vol in candles],
        columns=["ts_ms", "open", "high", "low", "close"],
    )
    # La bougie du jour est encore ouverte : la garder ferait entrer dans le
    # classement un prix non définitif, et le backtest n'a validé que des
    # clôtures. On la retire systématiquement.
    df = only_closed_candles(df.rename(columns={"close": "price"}), 24 * 60 * 60 * 1000)
    return df.rename(columns={"price": "close"}) if df is not None and len(df) else None


def run_relative_strength_engine() -> list:
    """
    Fait tourner le moteur Force Relative une fois par jour, après la clôture.

    Cadence. Le backtest évalue le classement UNE fois par jour sur des
    clôtures journalières. Le faire tourner à chaque cycle diffuserait une
    stratégie différente de celle qui a été validée — le classement bouge en
    cours de journée et on émettrait sur du bruit intrajournalier.

    Le déclenchement ne repose pas sur une fenêtre horaire mais sur un marqueur
    « déjà tourné aujourd'hui » (voir storage.daily_job_already_ran_today) : les
    crons GitHub Actions sont régulièrement retardés de 10 à 20 minutes, et une
    fenêtre étroite faisait passer des journées entières sans aucun signal.

    Anti-doublon et positions ouvertes sont le MÊME mécanisme ici : une paire
    signalée il y a moins de RS_HOLD_DAYS jours est considérée détenue, donc ne
    redéclenche pas. C'est exactement le comportement du backtest, qui ne
    compte que les entrées réelles.
    """
    if storage.daily_job_already_ran_today("relative_strength", config.RS_RUN_HOUR_UTC):
        return []

    held = storage.pairs_signalled_by_engine("relative_strength", config.RS_HOLD_DAYS * 24)
    daily_by_pair = {}
    for pair in config.PAIRS:
        df = fetch_daily_candles(pair)
        if df is not None and len(df) >= config.RS_RSI_PERIOD + 5:
            daily_by_pair[pair] = df

    btc_daily = daily_by_pair.get("BTC/USDT")
    if btc_daily is None:
        logger.warning(
            "[relative_strength] Bougies BTC indisponibles : impossible d'évaluer le filtre "
            "de tendance, aucun signal émis."
        )
        return []

    logger.info(
        "[relative_strength] Passage quotidien : %d paires récupérées, %d déjà en position.",
        len(daily_by_pair), len(held),
    )

    # Santé des sources. Depuis la désactivation du moteur Haute Confiance,
    # plus aucune boucle de 5 minutes n'interroge les APIs : ce passage
    # quotidien est devenu le seul point de mesure. Une panne est donc détectée
    # en un jour et non en quelques minutes — c'est le prix de ne plus faire
    # 11 520 appels quotidiens pour rien, et c'est acceptable puisque le moteur
    # lui-même ne décide qu'une fois par jour.
    consecutive_failures, should_alert = storage.record_source_health(
        len(daily_by_pair), len(config.PAIRS)
    )
    if should_alert:
        alerts.maybe_alert_data_outage(consecutive_failures)

    signals = detect_relative_strength_signals(daily_by_pair, btc_daily, already_open=held)

    # Marque le passage du jour AVANT de rendre les signaux, et même quand il
    # n'y en a aucun. C'est le cas le plus fréquent — le filtre de tendance est
    # fermé 41 % du temps — et ne pas le marquer relancerait le moteur à chaque
    # cycle de 30 minutes jusqu'au lendemain, soit une cinquantaine de passages
    # à 40 appels d'API pour rien.
    storage.record_heartbeat("relative_strength")

    return signals


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
    # Le moteur Force Relative travaille sur des bougies journalières et ne
    # produit pas de DataFrame horaire enrichi. Sortir tout de suite évite une
    # trace d'exception par signal, qui ferait croire à une panne dans les logs.
    if enriched_df is None:
        return None

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


def run_once(params: dict) -> tuple[int, int]:
    """
    Une passe complète sur toutes les paires. Les signaux détectés sont
    d'abord collectés (pas insérés) pour permettre au filtre anti-corrélation
    (voir correlation_guard.py) de les examiner ENSEMBLE avant toute
    écriture : si plus de 50% des paires signalent la même direction en
    moins de 4h, AUCUN de ces signaux n'est inséré et la génération est
    mise en pause 24h. Retourne (signaux effectivement insérés, nombre de
    paires pour lesquelles une source de données a répondu) — ce deuxième
    chiffre alimente le suivi de panne totale (voir alerts.py), distinct du
    nombre de signaux : 0 signal est normal et fréquent, 0 paire avec
    donnée signale que les 4 sources sont indisponibles.

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
    pairs_with_data = 0

    # Anti-doublon de la fenêtre de rattrapage : une seule lecture par cycle
    # (voir storage.pairs_signalled_since). La fenêtre de déduplication couvre
    # exactement la profondeur balayée par detect_signals_with_catchup — les
    # bougies étant horaires, N bougies = N heures — pour ne jamais réémettre
    # un croisement déjà diffusé au cycle précédent.
    dedup_hours = config.SIGNAL_CATCHUP_CANDLES  # bougies 1h -> heures
    recent_signalled_pairs = (
        storage.pairs_signalled_since(dedup_hours) if config.ENABLE_HIGH_CONFIDENCE_ENGINE else set()
    )

    # Moteur Haute Confiance désactivé (voir config.ENABLE_HIGH_CONFIDENCE_ENGINE) :
    # la boucle horaire entière est court-circuitée, y compris ses 40 appels
    # d'API par cycle de 5 minutes. `pairs_with_data` reste alors à None plutôt
    # qu'à 0, pour que le suivi de santé des sources sache faire la différence
    # entre « aucune source ne répond » et « on n'a rien demandé ».
    if not config.ENABLE_HIGH_CONFIDENCE_ENGINE:
        pairs_with_data = None

    for pair, coin_id in config.PAIRS.items() if config.ENABLE_HIGH_CONFIDENCE_ENGINE else ():
        df = fetch_recent_prices(pair, coin_id)
        if df is not None:
            df = only_closed_candles(df, 60 * 60 * 1000)
        if df is None or len(df) < config.MIN_HISTORY_POINTS:
            logger.warning("Historique insuffisant pour %s, ignoré ce cycle.", pair)
            continue
        pairs_with_data += 1

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

        # Fenêtre de rattrapage (voir config.SIGNAL_CATCHUP_CANDLES) : on
        # balaie les dernières bougies closes, pas seulement la dernière, pour
        # ne plus perdre les croisements des cycles cron sautés. Le plus
        # RÉCENT d'abord : si plusieurs bougies de la fenêtre ont produit un
        # signal sur la même paire, c'est le plus frais qui est le plus
        # pertinent (et une seule position par paire est ouverte de toute façon).
        found = detect_signals_with_catchup(
            enriched, pair, params["rsi_buy_threshold"], params["rsi_sell_threshold"],
            htf_ema50=htf_ema50,
        )
        signal_dict = None
        if found and pair in recent_signalled_pairs:
            logger.info("↩️ %s : signal déjà émis dans la fenêtre, rattrapage ignoré (anti-doublon).", pair)
            found = []
        for candidate in reversed(found):
            if not is_still_actionable(candidate, curr_price):
                logger.info(
                    "⏭️ %s : signal du %s ignoré, le marché a déjà quitté la zone d'entrée (prix %.8f vs entrée %.8f).",
                    pair, candidate.get("candle_ts_ms"), curr_price, candidate["entry_price"],
                )
                continue
            signal_dict = candidate
            break

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

    # ⚡ Moteur Squeeze Volatilité 15M (voir squeeze_engine.py) : totalement
    # indépendant de la boucle Haute Confiance ci-dessus, tourne en parallèle
    # sur des bougies 15 min pour augmenter la fréquence de signaux. Ses
    # candidats rejoignent le même `candidates` (donc le même filtre
    # anti-corrélation et le même verrou de portefeuille juste en dessous,
    # cohérent avec storage.count_open_at_risk_trades qui compte tous les
    # signaux ouverts sans distinction de moteur). Les échecs de fetch 15m ne
    # comptent pas dans `pairs_with_data` : ce compteur suit la panne de la
    # source de données elle-même (voir alerts.py), déjà couverte par la
    # boucle 1h ci-dessus qui interroge les mêmes APIs.
    if config.ENABLE_SQUEEZE_ENGINE:
        for pair in config.PAIRS:
            df15 = fetch_recent_prices_15m(pair)
            if df15 is not None:
                df15 = only_closed_candles(df15, 15 * 60 * 1000)
            min_points = config.SQUEEZE_LOOKBACK + config.SQUEEZE_BB_PERIOD
            if df15 is None or len(df15) < min_points:
                continue
            enriched15 = compute_all_indicators(
                df15, params["ema_fast"], params["ema_slow"],
                config.RSI_PERIOD, config.SQUEEZE_BB_PERIOD, config.SQUEEZE_BB_STD,
            )
            squeeze_signal = detect_squeeze_signal(enriched15, pair)
            if squeeze_signal:
                candidates.append((squeeze_signal, enriched15))

    # 📈 Moteur Force Relative (voir relative_strength.py). Seul moteur du
    # projet reposant sur un avantage effectivement mesuré : +83,3 %/an composé
    # sur 6 ans, aucune année perdante, contre une famille de règles techniques
    # absolues dont ~35 variantes ont toutes échoué. Il tourne en journalier et
    # une seule fois par jour, d'où le fait qu'il ne rende rien la quasi-totalité
    # des cycles. Ses candidats rejoignent le même `candidates` que les autres
    # moteurs, donc le même filtre anti-corrélation et le même verrou de
    # portefeuille juste en dessous.
    if config.ENABLE_RELATIVE_STRENGTH_ENGINE:
        for rs_signal in run_relative_strength_engine():
            # Pas de DataFrame enrichi horaire pour ces signaux : ils sont
            # construits sur des bougies journalières. Le None est accepté en
            # aval (le graphique est optionnel, voir generate_chart).
            candidates.append((rs_signal, None))

    if momentum_alerts:
        storage.insert_momentum_alerts(momentum_alerts)
        logger.info("%d alerte(s) momentum détectée(s) ce cycle.", len(momentum_alerts))

    if volatility_suspensions:
        storage.insert_volatility_suspensions(volatility_suspensions)

    if not candidates:
        return 0, pairs_with_data

    if correlation_guard.check_and_maybe_pause([c[0] for c in candidates]):
        logger.warning(
            "🚫 %d signal(aux) détecté(s) mais NON envoyés : mouvement de marché corrélé détecté, "
            "génération mise en pause 24h par sécurité.", len(candidates),
        )
        return 0, pairs_with_data

    # Verrou de portefeuille (mission "grille d'excellence", voir
    # config.MAX_ACTIVE_TRADES) : ne jamais dépasser N positions à risque
    # (pas encore sécurisées à TP1) simultanément. Priorité aux candidats du
    # score de confiance le plus élevé si plusieurs se présentent au même
    # cycle et qu'il ne reste pas assez de slots pour tous.
    if config.ENABLE_PORTFOLIO_LOCK:
        open_at_risk = storage.count_open_at_risk_trades()
        available_slots = max(0, config.MAX_ACTIVE_TRADES - open_at_risk)
        if available_slots < len(candidates):
            candidates.sort(key=lambda c: c[0].get("confidence_score", 0), reverse=True)
            skipped = len(candidates) - available_slots
            candidates = candidates[:available_slots]
            logger.info(
                "🔒 Verrou de portefeuille : %d position(s) à risque déjà ouverte(s) (max %d) -> "
                "%d slot(s) disponible(s), %d candidat(s) ignoré(s) ce cycle.",
                open_at_risk, config.MAX_ACTIVE_TRADES, available_slots, skipped,
            )

    failed_inserts = 0
    for signal_dict, enriched in candidates:
        signal_dict["chart_url"] = _generate_and_upload_chart(enriched, signal_dict, now_ms)
        # Métadonnée interne à la détection (fraîcheur/anti-doublon de la
        # fenêtre de rattrapage), sans colonne correspondante en base : la
        # laisser ferait échouer l'insertion entière du signal.
        signal_dict.pop("candle_ts_ms", None)
        # Même raison pour les métadonnées du moteur Force Relative : rang dans
        # le classement, RSI et durée de détention prévue n'ont pas de colonne
        # en base. Elles sont utiles au débogage et au message envoyé aux
        # abonnés, mais les laisser ferait échouer l'insertion entière.
        for key in ("rs_rank", "rs_rsi", "rs_hold_days"):
            signal_dict.pop(key, None)
        if not storage.insert_signal(signal_dict):
            failed_inserts += 1

    if failed_inserts:
        alerts.alert_insert_failure(failed_inserts, len(candidates))

    return len(candidates) - failed_inserts, pairs_with_data


def main():
    logger.info("Exécution unique du module de signaux (%d paires, source hybride 4 niveaux).", len(config.PAIRS))

    active_pause = correlation_guard.get_active_pause()
    if active_pause:
        logger.warning(
            "⏸️ Génération de signaux en pause jusqu'à %s (%s).",
            active_pause["resumes_at"], active_pause["reason"],
        )
        storage.record_heartbeat("signals")  # la pause est un état normal, pas une panne
        return

    # Garde-fou d'espérance réalisée (voir edge_guard.py) : si les signaux
    # réellement clôturés montrent une espérance nettement négative sur un
    # échantillon suffisant, on suspend plutôt que de continuer à diffuser à
    # des abonnés payants une stratégie que nos propres mesures disent
    # perdante. Dormant tant qu'il n'y a pas assez de trades clôturés.
    degraded, edge_stats = edge_guard.should_pause_for_degraded_edge()
    if degraded:
        edge_guard.register_pause(edge_stats)
        alerts.alert_degraded_edge(edge_stats)
        storage.record_heartbeat("signals")
        return
    if edge_stats["count"] >= edge_guard.MIN_CLOSED_TRADES:
        logger.info(
            "Espérance réalisée : %+.3f%%/trade sur %d signaux clôturés (réussite %.1f%%).",
            edge_stats["expectancy_pct"], edge_stats["count"], edge_stats["win_rate_pct"],
        )

    params = load_active_params()
    signals_found, pairs_with_data = run_once(params)
    logger.info(
        "Terminé : %d signal(aux) détecté(s) sur ce cycle (%s).",
        signals_found,
        f"{pairs_with_data}/{len(config.PAIRS)} paires avec donnée"
        if pairs_with_data is not None
        else "boucle horaire désactivée, aucune donnée demandée",
    )

    # `None` signifie « on n'a interrogé aucune source ce cycle », ce qui arrive
    # à chaque cycle depuis la désactivation du moteur Haute Confiance. Le
    # traiter comme 0 déclencherait une alerte de panne de données toutes les
    # 5 minutes. La santé des sources est désormais mesurée par le moteur Force
    # Relative lors de son passage quotidien (voir run_relative_strength_engine).
    if pairs_with_data is not None:
        consecutive_failures, should_alert = storage.record_source_health(pairs_with_data, len(config.PAIRS))
        if should_alert:
            alerts.maybe_alert_data_outage(consecutive_failures)

    storage.record_heartbeat("signals")


if __name__ == "__main__":
    main()
