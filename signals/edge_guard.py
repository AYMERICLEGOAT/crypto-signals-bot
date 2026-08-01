"""
Garde-fou d'espérance réalisée (audit du 01/08/2026).

Motif : le walk-forward a montré que l'espérance de la stratégie est passée
de +0,065% à -0,029% par trade entre les deux semestres (voir
DIAGNOSTIC_SIGNAUX_2026-08-01.md). Un edge peut se dégrader sans que rien
ne le signale — le win rate reste flatteur (60%) alors que le ratio
gain/perte (0,67) rend l'ensemble déficitaire. Personne ne s'en aperçoit
tant qu'on ne mesure que le taux de réussite.

Ce module mesure l'espérance sur les signaux RÉELLEMENT clôturés (pas le
backtest) et suspend la génération si elle devient durablement négative.
Objectif : ne jamais continuer à diffuser à des abonnés payants une
stratégie que nos propres mesures montrent perdante.

Prudence délibérée dans les deux sens :
  - il faut un échantillon minimum (MIN_CLOSED_TRADES) pour conclure : une
    série de pertes sur 5 trades n'est pas une dégradation d'edge ;
  - toute erreur de lecture laisse passer plutôt que de bloquer (une
    suspension à tort couperait le service pour rien).
"""

import logging
from datetime import datetime, timedelta, timezone

import config
from storage import get_client

logger = logging.getLogger(__name__)

# En dessous, la moyenne n'a aucune signification statistique : sur un edge
# à ~60% de réussite, des séries de 10 pertes d'affilée sont banales.
MIN_CLOSED_TRADES = 30
LOOKBACK_DAYS = 90
# Marge sous zéro avant de suspendre : une espérance très légèrement
# négative est indiscernable du bruit d'échantillonnage. On ne coupe que sur
# une dégradation nette.
EXPECTANCY_FLOOR_PCT = -0.05
PAUSE_DURATION_HOURS = 24


def _realized_pnl_pct(signal: dict) -> float | None:
    """
    Rendement réalisé d'un signal clôturé, en fraction du prix d'entrée, en
    reproduisant la sortie Multi-TP (TP1 sécurise une part et passe au
    break-even, TP2 puis TP3 ferment le reste) — même pondération que
    backtest.simulate_portfolio_capped, pour que le chiffre mesuré en réel
    soit directement comparable à celui du backtest.
    """
    entry = signal.get("entry_price")
    exit_price = signal.get("outcome_price")
    side = signal.get("type")
    if not entry or not exit_price or side not in ("BUY", "SELL"):
        return None

    def ret(level):
        return (level - entry) / entry if side == "BUY" else (entry - level) / entry

    w1 = config.MULTI_TP_TP1_WEIGHT
    w2 = config.MULTI_TP_TP2_WEIGHT
    tp1, tp2, tp3 = signal.get("tp1_price"), signal.get("tp2_price"), signal.get("tp3_price")

    # Signal antérieur au Multi-TP (ou niveaux absents) : rendement simple.
    if not (tp1 and tp2 and tp3):
        return ret(exit_price)

    total = 0.0
    remaining = 1.0
    if signal.get("tp1_hit_at"):
        total += w1 * ret(tp1)
        remaining -= w1
    if signal.get("tp2_hit_at"):
        total += w2 * ret(tp2)
        remaining -= w2
    if signal.get("tp3_hit_at"):
        total += remaining * ret(tp3)
        remaining = 0.0
    if remaining > 0:
        total += remaining * ret(exit_price)
    return total


def measure_realized_edge(lookback_days: int = LOOKBACK_DAYS) -> dict:
    """
    Statistiques réalisées sur les signaux clôturés de la fenêtre.
    Retourne {"count", "expectancy_pct", "win_rate_pct"} ; count=0 si la
    lecture échoue ou si rien n'est clôturé.
    """
    since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat()
    try:
        res = (
            get_client()
            .table("signals")
            .select("type,entry_price,outcome,outcome_price,tp1_price,tp2_price,tp3_price,"
                    "tp1_hit_at,tp2_hit_at,tp3_hit_at")
            .not_.is_("outcome", "null")
            .gte("created_at", since)
            .execute()
        )
        rows = res.data or []
    except Exception:
        logger.exception("Échec de la lecture des signaux clôturés (garde-fou d'espérance) — non bloquant.")
        return {"count": 0, "expectancy_pct": 0.0, "win_rate_pct": 0.0}

    pnls = [p for p in (_realized_pnl_pct(r) for r in rows) if p is not None]
    if not pnls:
        return {"count": 0, "expectancy_pct": 0.0, "win_rate_pct": 0.0}

    wins = sum(1 for p in pnls if p > 0)
    return {
        "count": len(pnls),
        "expectancy_pct": (sum(pnls) / len(pnls)) * 100,
        "win_rate_pct": (wins / len(pnls)) * 100,
    }


def should_pause_for_degraded_edge() -> tuple[bool, dict]:
    """
    True si l'espérance réalisée est nettement négative sur un échantillon
    suffisant. L'appelant (main.py) suspend alors la génération et alerte.
    """
    stats = measure_realized_edge()
    if stats["count"] < MIN_CLOSED_TRADES:
        return False, stats
    return stats["expectancy_pct"] < EXPECTANCY_FLOOR_PCT, stats


def register_pause(stats: dict) -> None:
    """Enregistre la suspension dans signal_pause (même table que le filtre
    anti-corrélation, voir correlation_guard.py) — le Worker la relaie dans
    le canal public via cron/announceSignalPause.ts."""
    resumes_at = datetime.now(timezone.utc) + timedelta(hours=PAUSE_DURATION_HOURS)
    reason = (
        f"Espérance réalisée dégradée : {stats['expectancy_pct']:+.3f}% par trade "
        f"sur {stats['count']} signaux clôturés (taux de réussite {stats['win_rate_pct']:.1f}%). "
        "Génération suspendue par sécurité."
    )
    try:
        get_client().table("signal_pause").insert({
            "resumes_at": resumes_at.isoformat(),
            "reason": reason,
        }).execute()
        logger.warning("⏸️ %s", reason)
    except Exception:
        logger.exception("Échec de l'enregistrement de la suspension pour espérance dégradée.")
