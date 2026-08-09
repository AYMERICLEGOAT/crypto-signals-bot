"""
Accès à Supabase via le SDK officiel `supabase-py`.
"""

from datetime import datetime, timezone

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

_client = None


def _get_client():
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError("SUPABASE_URL / SUPABASE_KEY manquants dans .env")
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


def get_latest_signal():
    """Le signal le plus récent, tous statuts confondus (envoyé ou non)."""
    resp = _get_client().table("signals").select("*").order("created_at", desc=True).limit(1).execute()
    return resp.data[0] if resp.data else None


def get_posted_signal_ids(platform, limit=100):
    """IDs des signaux déjà publiés sur `platform`, pour ne jamais republier le même."""
    resp = (
        _get_client()
        .table("posted_content")
        .select("signal_id")
        .eq("platform", platform)
        .order("posted_at", desc=True)
        .limit(limit)
        .execute()
    )
    return {row["signal_id"] for row in resp.data}


def get_posted_content(platform, limit=500):
    """
    Publications déjà faites sur `platform`, avec leur `target`.

    Distinct de get_posted_signal_ids : celui-ci suit des SIGNAUX (colonne
    signal_id), celui-là suit du contenu identifié par une chaîne — le slug d'un
    article, par exemple, qui n'a aucun signal associé. Réutiliser la première
    aurait obligé à inventer un signal_id fictif pour chaque article.
    """
    resp = (
        _get_client()
        .table("posted_content")
        .select("target,posted_at")
        .eq("platform", platform)
        .order("posted_at", desc=True)
        .limit(limit)
        .execute()
    )
    return resp.data or []


def get_last_post(platform):
    """Dernière publication connue sur `platform` (dict avec posted_at, target), ou None."""
    resp = (
        _get_client()
        .table("posted_content")
        .select("*")
        .eq("platform", platform)
        .order("posted_at", desc=True)
        .limit(1)
        .execute()
    )
    return resp.data[0] if resp.data else None


def count_posts_since(platform, since_dt: datetime):
    """Nombre de publications sur `platform` depuis `since_dt` (objet datetime, tz-aware)."""
    resp = (
        _get_client()
        .table("posted_content")
        .select("id", count="exact")
        .eq("platform", platform)
        .gte("posted_at", since_dt.isoformat())
        .execute()
    )
    return resp.count or 0


def record_posted(platform, signal_id, target=None):
    payload = {
        "platform": platform,
        "signal_id": signal_id,
        "target": target,
        "posted_at": datetime.now(timezone.utc).isoformat(),
    }
    resp = _get_client().table("posted_content").insert(payload).execute()
    return resp.data
