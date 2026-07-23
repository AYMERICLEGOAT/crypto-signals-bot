"""
Persistance des paramètres de stratégie retenus par backtest.py dans
Supabase (table `strategy_params`, voir schema_strategy_params.sql).

Remplace l'ancien fichier local data/optimized_params.json : un run
GitHub Actions démarre à chaque fois sur une machine neuve, un fichier
local ne survivrait donc pas d'une exécution à l'autre.
"""

import logging

from storage import get_client

logger = logging.getLogger(__name__)

TABLE = "strategy_params"


def load_active_params() -> dict | None:
    """Retourne la ligne is_active=true la plus récente, ou None si aucune."""
    try:
        res = (
            get_client()
            .table(TABLE)
            .select("*")
            .eq("is_active", True)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception:
        logger.exception("Échec de la lecture des paramètres actifs dans Supabase.")
        return None


def save_params(result: dict, pairs_tested: list[str]) -> None:
    """
    Désactive l'ancienne ligne active (s'il y en a une) puis insère `result`
    comme nouvelle combinaison active. Conserve l'historique (aucune ligne
    n'est jamais supprimée).
    """
    client = get_client()
    try:
        client.table(TABLE).update({"is_active": False}).eq("is_active", True).execute()
        client.table(TABLE).insert({
            "ema_fast": result["ema_fast"],
            "ema_slow": result["ema_slow"],
            "rsi_buy_threshold": result["rsi_buy_threshold"],
            "rsi_sell_threshold": result["rsi_sell_threshold"],
            "total_trades": result["total_trades"],
            "global_win_rate": result["global_win_rate"],
            "gain_loss_ratio": result.get("gain_loss_ratio"),
            "max_drawdown_pct": result.get("max_drawdown_pct"),
            "source": result["source"],
            "pairs_tested": ",".join(pairs_tested),
            "is_active": True,
        }).execute()
        logger.info("Paramètres enregistrés comme actifs dans Supabase (strategy_params).")
    except Exception:
        logger.exception("Échec de l'enregistrement des paramètres dans Supabase.")
