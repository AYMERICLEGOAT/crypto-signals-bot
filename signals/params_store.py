"""
Persistance des paramètres de stratégie retenus par backtest.py dans
Supabase (table `strategy_params`).

⚠️ Le schéma réel de cette table en base (colonnes param_set, rsi_period,
rsi_oversold, rsi_overbought, tp_pct, sl_pct, win_rate, trade_count,
last_tested) diffère de signals/schema_strategy_params.sql — une autre
requête que ce fichier a été exécutée dans le SQL Editor Supabase. Ce module
écrit dans le schéma réel (voir mapping ci-dessous) plutôt que dans celui du
fichier .sql, qui ne reflète donc plus l'état actuel de la base.

Remplace l'ancien fichier local data/optimized_params.json : un run
GitHub Actions démarre à chaque fois sur une machine neuve, un fichier
local ne survivrait donc pas d'une exécution à l'autre.
"""

import logging
from datetime import datetime, timezone

import config
from storage import get_client

logger = logging.getLogger(__name__)

TABLE = "strategy_params"
TRADES_TABLE = "backtest_trades"


def load_active_params() -> dict | None:
    """
    Retourne la ligne is_active=true la plus récente (mappée vers les clés
    utilisées par main.py : ema_fast, ema_slow, rsi_buy_threshold,
    rsi_sell_threshold), ou None si aucune n'existe.
    """
    try:
        res = (
            get_client()
            .table(TABLE)
            .select("*")
            .eq("is_active", True)
            .order("last_tested", desc=True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        row = res.data[0]
        return {
            "ema_fast": row["ema_fast"],
            "ema_slow": row["ema_slow"],
            "rsi_buy_threshold": row["rsi_oversold"],
            "rsi_sell_threshold": row["rsi_overbought"],
            "source": row.get("param_set"),
            "global_win_rate": row.get("win_rate"),
        }
    except Exception:
        logger.exception("Échec de la lecture des paramètres actifs dans Supabase.")
        return None


def save_params(result: dict, pairs_tested: list[str]) -> None:
    """
    Désactive l'ancienne ligne active (s'il y en a une) puis insère `result`
    comme nouvelle combinaison active. Conserve l'historique (aucune ligne
    n'est jamais supprimée).

    Le schéma réel de strategy_params n'a pas de colonne pour
    gain_loss_ratio / max_drawdown_pct / pairs_tested : ces valeurs restent
    donc uniquement dans les logs de backtest.py, pas persistées ici.
    """
    client = get_client()
    # Horodatage inclus : param_set a une contrainte UNIQUE en base, et les
    # paramètres par défaut reviennent souvent identiques d'un run à l'autre
    # (ex: "EMA9-21_RSI40-60_default") — sans suffixe, le 2e insert échoue en
    # silence (conflit 409) et la ligne active de la veille n'est JAMAIS
    # remplacée alors qu'elle vient d'être désactivée juste avant.
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    param_set = (
        f"EMA{result['ema_fast']}-{result['ema_slow']}_"
        f"RSI{result['rsi_buy_threshold']}-{result['rsi_sell_threshold']}_{result['source']}_{timestamp}"
    )
    try:
        client.table(TABLE).update({"is_active": False}).eq("is_active", True).execute()
        client.table(TABLE).insert({
            "param_set": param_set,
            "ema_fast": result["ema_fast"],
            "ema_slow": result["ema_slow"],
            "rsi_period": config.RSI_PERIOD,
            "rsi_oversold": result["rsi_buy_threshold"],
            "rsi_overbought": result["rsi_sell_threshold"],
            "tp_pct": config.TAKE_PROFIT_PCT,
            "sl_pct": config.STOP_LOSS_PCT,
            "win_rate": result["global_win_rate"],
            "trade_count": result["total_trades"],
            "is_active": True,
            # Mission "grille d'excellence" : trace la config Multi-TP active
            # au moment de ce backtest (pilotée par config.py, pas par cette
            # table -- purement informatif/historique ici).
            "multi_tp_enabled": config.ENABLE_MULTI_TP_EXITS,
            "sl_atr_mult": config.MULTI_TP_SL_MULTIPLIER,
            "tp1_atr_mult": config.MULTI_TP_TP1_MULTIPLIER,
            "tp2_atr_mult": config.MULTI_TP_TP2_MULTIPLIER,
            "tp3_atr_mult": config.MULTI_TP_TP3_MULTIPLIER,
            "tp1_weight": config.MULTI_TP_TP1_WEIGHT,
            "tp2_weight": config.MULTI_TP_TP2_WEIGHT,
            "tp3_weight": config.MULTI_TP_TP3_WEIGHT,
        }).execute()
        logger.info("Paramètres enregistrés comme actifs dans Supabase (strategy_params: %s).", param_set)
    except Exception:
        logger.exception("Échec de l'enregistrement des paramètres dans Supabase.")


def _ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def save_backtest_trades(trades: list[dict]) -> None:
    """
    Remplace le contenu de backtest_trades par `trades` (vide la table puis
    réinsère) : ce sont des exemples illustrant la stratégie ACTIVE, pas un
    journal cumulatif — chaque nouveau backtest reflète les paramètres
    actuellement en vigueur. entered_at/exited_at sont les vrais timestamps
    des bougies Binance utilisées dans la simulation, jamais des dates
    inventées (voir backtest.py, simulate_trades).
    """
    if not trades:
        return
    client = get_client()
    try:
        client.table(TRADES_TABLE).delete().neq("id", 0).execute()
        rows = [{
            "pair": t["pair"],
            "side": t["side"],
            "entry_price": t["entry_price"],
            "exit_price": t["exit_price"],
            "outcome": t["outcome"],
            "pnl_pct": t["pnl_pct"],
            "entered_at": _ms_to_iso(t["entered_at"]),
            "exited_at": _ms_to_iso(t["exited_at"]),
        } for t in trades]
        client.table(TRADES_TABLE).insert(rows).execute()
    except Exception:
        logger.exception("Échec de l'enregistrement des trades individuels du backtest.")
