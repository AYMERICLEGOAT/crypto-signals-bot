"""
Filtre anti-corrélation : si plus de CORRELATION_THRESHOLD (50%) des paires
suivies déclenchent un signal dans la MÊME direction en moins de
CORRELATION_WINDOW_HOURS (4h), c'est un mouvement de marché systémique
(tout corrélé, ex: krach ou rebond général), pas un edge de la stratégie —
la fiabilité statistique d'un signal EMA/RSI par paire suppose une certaine
indépendance entre paires, qui s'effondre dans ce cas précis.

Dans ce cas : bloque toute nouvelle génération de signal pendant
PAUSE_DURATION_HOURS (24h) et enregistre la pause dans Supabase (table
signal_pause) — le Worker (cron/announceSignalPause.ts) poste l'avertissement
dans le canal public à partir de cette table.
"""

import logging
from datetime import datetime, timedelta, timezone

import config
from storage import get_client

logger = logging.getLogger(__name__)

CORRELATION_THRESHOLD = 0.5
CORRELATION_WINDOW_HOURS = 4
PAUSE_DURATION_HOURS = 24


def get_active_pause() -> dict | None:
    """Retourne la pause active (resumes_at dans le futur) la plus récente, ou None."""
    try:
        res = (
            get_client()
            .table("signal_pause")
            .select("*")
            .gt("resumes_at", datetime.now(timezone.utc).isoformat())
            .order("resumes_at", desc=True)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception:
        logger.exception("Échec de la lecture de signal_pause — on continue sans bloquer par prudence.")
        return None


def _recent_signal_directions(window_start_iso: str) -> list[dict]:
    res = (
        get_client()
        .table("signals")
        .select("pair,type")
        .gte("created_at", window_start_iso)
        .execute()
    )
    return res.data or []


def check_and_maybe_pause(candidate_signals: list[dict]) -> bool:
    """
    `candidate_signals` : signaux détectés ce cycle, pas encore insérés
    (dicts avec au moins "pair" et "type").

    Combine avec les signaux déjà en base sur la fenêtre de corrélation, et
    si plus de la moitié des paires suivies ont signalé la même direction
    sur cette fenêtre, déclenche une pause de 24h et retourne True (le
    cycle appelant ne doit alors insérer AUCUN des candidats).
    """
    if not candidate_signals:
        return False

    window_start = datetime.now(timezone.utc) - timedelta(hours=CORRELATION_WINDOW_HOURS)
    try:
        recent = _recent_signal_directions(window_start.isoformat())
    except Exception:
        logger.exception("Échec de la lecture des signaux récents pour le filtre anti-corrélation — on continue sans bloquer.")
        return False

    combined = recent + [{"pair": s["pair"], "type": s["type"]} for s in candidate_signals]
    total_pairs = len(config.PAIRS)
    threshold_count = total_pairs * CORRELATION_THRESHOLD

    for direction in ("BUY", "SELL"):
        distinct_pairs = {row["pair"] for row in combined if row["type"] == direction}
        if len(distinct_pairs) > threshold_count:
            reason = (
                f"{len(distinct_pairs)}/{total_pairs} paires ont signalé {direction} en moins de "
                f"{CORRELATION_WINDOW_HOURS}h (seuil : {threshold_count:.0f}) — mouvement de marché "
                f"corrélé, pause de sécurité."
            )
            _trigger_pause(reason)
            return True

    return False


def _trigger_pause(reason: str) -> None:
    resumes_at = datetime.now(timezone.utc) + timedelta(hours=PAUSE_DURATION_HOURS)
    try:
        get_client().table("signal_pause").insert({
            "resumes_at": resumes_at.isoformat(),
            "reason": reason,
        }).execute()
        logger.warning("⏸️ Génération de signaux mise en pause 24h : %s", reason)
    except Exception:
        logger.exception("Échec de l'enregistrement de la pause anti-corrélation dans Supabase.")
