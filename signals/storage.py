"""
Persistance des signaux générés dans Supabase (PostgreSQL gratuit).
Utilise le client officiel `supabase-py` (simple appel REST, pas besoin
de compiler de driver PostgreSQL natif).
"""

import logging
from supabase import create_client, Client

from config import SUPABASE_URL, SUPABASE_KEY, SUPABASE_STORAGE_BUCKET

logger = logging.getLogger(__name__)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL / SUPABASE_KEY manquants. Renseigne le fichier .env "
                "(voir .env.example)."
            )
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


def insert_signal(signal: dict) -> None:
    """Insère un signal dans la table `signals`. `sent` démarre à False."""
    payload = {**signal, "sent": False}
    try:
        get_client().table("signals").insert(payload).execute()
        logger.info("Signal enregistré: %s %s @ %s", signal["pair"], signal["type"], signal["entry_price"])
    except Exception:
        logger.exception("Échec de l'insertion du signal dans Supabase: %s", signal)


def insert_momentum_alerts(alerts: list) -> None:
    """
    Insère les Alertes Momentum (Bloc 3) détectées ce cycle. Échec non
    bloquant (comme insert_signal) : une alerte momentum manquante ne doit
    jamais faire échouer la génération des vrais signaux.
    """
    if not alerts:
        return
    payload = [{**alert, "sent_to_channel": False} for alert in alerts]
    try:
        get_client().table("momentum_alerts").insert(payload).execute()
        logger.info("%d alerte(s) momentum enregistrée(s).", len(payload))
    except Exception:
        logger.exception("Échec de l'insertion des alertes momentum dans Supabase: %s", payload)


def record_heartbeat(job_name: str) -> None:
    """
    Bloc 8 — surveillance de fraîcheur GitHub Actions : marque que ce job a
    tourné jusqu'au bout avec succès. Le Worker (cron/monitorSignalsHeartbeat.ts)
    alerte l'administrateur si ce timestamp devient trop vieux (le workflow
    GitHub Actions horaire a dû s'arrêter silencieusement). `alerted` est
    remis à False à chaque heartbeat réussi, pour permettre une nouvelle
    alerte si une panne future survient après une reprise.
    """
    try:
        get_client().table("system_heartbeats").upsert(
            {"job_name": job_name, "last_run_at": _now_iso(), "alerted": False}, on_conflict="job_name"
        ).execute()
    except Exception:
        logger.exception("Échec de l'enregistrement du heartbeat pour %s.", job_name)


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def upload_chart(local_path: str, remote_filename: str) -> str | None:
    """
    Envoie le PNG généré par chart_generator.py vers Supabase Storage et
    retourne son URL publique (ou None en cas d'échec — un signal sans
    graphique reste utile, mieux vaut ne pas bloquer l'insertion pour ça).
    Le bucket (SUPABASE_STORAGE_BUCKET, "signal-charts" par défaut) doit
    exister et être public — à créer une fois via le Dashboard Supabase
    (voir README).
    """
    try:
        with open(local_path, "rb") as f:
            data = f.read()
        bucket = get_client().storage.from_(SUPABASE_STORAGE_BUCKET)
        bucket.upload(remote_filename, data, {"content-type": "image/png", "upsert": "true"})
        return bucket.get_public_url(remote_filename)
    except Exception:
        logger.exception("Échec de l'envoi du graphique %s vers Supabase Storage.", remote_filename)
        return None
