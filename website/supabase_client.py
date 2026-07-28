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


def get_backtest_trades(limit=50):
    """
    Exemples de trades issus du dernier backtest.py (voir signals/backtest.py,
    save_backtest_trades) — vraies dates historiques (bougies Binance réelles
    utilisées dans la simulation), jamais inventées. Ce sont des exemples de
    la stratégie backtestée, PAS des signaux réellement envoyés aux abonnés.
    """
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/backtest_trades",
        headers=_headers(),
        params={"order": "entered_at.desc", "limit": str(limit)},
        timeout=15,
    )
    _check(resp, "select backtest_trades")
    return resp.json()


def get_daily_stats_history(limit=90):
    """
    Instantanés quotidiens de croissance (voir workers/main-worker/src/db/dailyStats.ts,
    computeAndStoreDailyStats — un par jour), du plus récent au plus ancien.
    N'inclut PAS total_revenue_usdt : donnée interne, pas destinée à la page
    de transparence publique (voir website/transparency_generator.py).
    """
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/daily_stats",
        headers=_headers(),
        params={
            "select": "stat_date,total_users,active_trials,paying_subscribers,winrate_rolling_30d",
            "order": "stat_date.desc",
            "limit": str(limit),
        },
        timeout=15,
    )
    _check(resp, "select daily_stats")
    return resp.json()


def get_all_resolved_signals(limit=500):
    """
    Amélioration Bloc 11.1 : TOUS les signaux résolus (pas seulement les
    `limit` plus récents comme get_performance_window), triés du plus ANCIEN
    au plus récent -- nécessaire pour reconstituer une courbe d'équité
    chronologique (portefeuille fictif), pas juste un instantané.
    """
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/signals",
        headers=_headers(),
        params={
            "select": "pair,type,entry_price,outcome_price,outcome,close_reason,evaluated_at",
            "outcome": "not.is.null",
            "order": "evaluated_at.asc",
            "limit": str(limit),
        },
        timeout=15,
    )
    _check(resp, "select signals (courbe d'équité)")
    return resp.json()


def get_recent_reviews(limit=10):
    """
    Étape 3 (preuve sociale) : derniers avis /review ayant un commentaire non
    vide (voir workers/main-worker/src/db/reviews.ts) -- jamais le
    telegram_id (anonymisé côté select). Retourne [] si aucun avis avec
    commentaire n'existe encore (le site retombe alors sur les exemples
    fictifs explicitement étiquetés comme tels, voir testimonials.py).
    """
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/reviews",
        headers=_headers(),
        params={
            "select": "rating,comment,created_at",
            "comment": "not.is.null",
            "order": "created_at.desc",
            "limit": str(limit),
        },
        timeout=15,
    )
    _check(resp, "select reviews")
    return resp.json()


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
