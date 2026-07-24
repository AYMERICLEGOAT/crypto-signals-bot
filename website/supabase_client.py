"""
Client REST minimal pour Supabase (PostgREST), via `requests`. Pas besoin du
SDK supabase-py pour les quelques opérations nécessaires ici.
"""

import requests

from config import SUPABASE_URL, SUPABASE_KEY


def _headers(extra=None):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def _check(resp, action):
    if not resp.ok:
        raise RuntimeError(f"Supabase {action} a répondu {resp.status_code}: {resp.text}")


def get_recent_signals(limit=5):
    """Les `limit` derniers signaux (envoyés ou non), du plus récent au plus ancien."""
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/signals",
        headers=_headers(),
        params={"order": "created_at.desc", "limit": str(limit)},
        timeout=15,
    )
    _check(resp, "select signals (récents)")
    return resp.json()


def get_unresolved_signals(max_age_days):
    """Signaux sans résultat connu (outcome IS NULL), pas plus vieux que max_age_days."""
    from datetime import datetime, timezone, timedelta

    since = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/signals",
        headers=_headers(),
        params={
            "outcome": "is.null",
            "created_at": f"gte.{since}",
            "order": "created_at.asc",
        },
        timeout=15,
    )
    _check(resp, "select signals (non résolus)")
    return resp.json()


def get_expired_unresolved_signals(max_age_days):
    """Signaux non résolus plus vieux que max_age_days -> à clôturer en perte (timeout)."""
    from datetime import datetime, timezone, timedelta

    threshold = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat()
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/signals",
        headers=_headers(),
        params={"outcome": "is.null", "created_at": f"lt.{threshold}"},
        timeout=15,
    )
    _check(resp, "select signals (expirés)")
    return resp.json()


def update_signal_outcome(signal_id, outcome, outcome_price):
    from datetime import datetime, timezone

    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/signals",
        headers=_headers({"Prefer": "return=representation"}),
        params={"id": f"eq.{signal_id}"},
        json={
            "outcome": outcome,
            "outcome_price": outcome_price,
            "evaluated_at": datetime.now(timezone.utc).isoformat(),
        },
        timeout=15,
    )
    _check(resp, "update signal outcome")
    return resp.json()


def get_active_backtest_stats():
    """
    La ligne is_active=true la plus récente de strategy_params (résultat du
    dernier backtest.py, voir signals/backtest.py) — win_rate et trade_count
    réels, jamais codés en dur. Retourne None si aucun backtest n'a encore
    été enregistré.
    """
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/strategy_params",
        headers=_headers(),
        params={"is_active": "eq.true", "order": "last_tested.desc", "limit": "1"},
        timeout=15,
    )
    _check(resp, "select strategy_params (actif)")
    rows = resp.json()
    return rows[0] if rows else None


def get_performance_window(limit):
    """Les `limit` signaux les plus récents ayant un résultat connu (WIN/LOSS)."""
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/signals",
        headers=_headers(),
        params={"outcome": "not.is.null", "order": "evaluated_at.desc", "limit": str(limit)},
        timeout=15,
    )
    _check(resp, "select signals (performance)")
    return resp.json()
