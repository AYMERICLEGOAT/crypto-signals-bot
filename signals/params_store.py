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

import config
from storage import get_client

logger = logging.getLogger(__name__)

TABLE = "strategy_params"


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
    param_set = (
        f"EMA{result['ema_fast']}-{result['ema_slow']}_"
        f"RSI{result['rsi_buy_threshold']}-{result['rsi_sell_threshold']}_{result['source']}"
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
        }).execute()
        logger.info("Paramètres enregistrés comme actifs dans Supabase (strategy_params: %s).", param_set)
    except Exception:
        logger.exception("Échec de l'enregistrement des paramètres dans Supabase.")
