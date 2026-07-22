"""
Cache local SQLite : conserve l'historique de prix par paire pour que
le script puisse calculer des indicateurs dès le démarrage et reprendre
sans perte après un arrêt/redémarrage (SIGTERM, crash, coupure PC).

Ce n'est PAS la base "métier" (Supabase) : c'est un cache technique local,
jetable si besoin (il se reconstruit via bootstrap_history()).
"""

import contextlib
import os
import sqlite3
import pandas as pd

from config import LOCAL_CACHE_DB_PATH, MAX_HISTORY_POINTS


@contextlib.contextmanager
def _connect():
    """
    Ouvre une connexion SQLite, garantit la création du schéma, commit/rollback
    la transaction à la sortie du bloc `with`, ET ferme la connexion.
    (sqlite3.Connection utilisé comme context manager ne fait QUE le
    commit/rollback, pas la fermeture -> sans ce wrapper, main.py qui tourne
    en boucle indéfiniment finirait par accumuler des connexions ouvertes.)
    """
    os.makedirs(os.path.dirname(LOCAL_CACHE_DB_PATH), exist_ok=True)
    conn = sqlite3.connect(LOCAL_CACHE_DB_PATH)
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS price_history (
                pair   TEXT NOT NULL,
                ts_ms  INTEGER NOT NULL,
                price  REAL NOT NULL,
                PRIMARY KEY (pair, ts_ms)
            )
            """
        )
        with conn:
            yield conn
    finally:
        conn.close()


def append_price(pair: str, ts_ms: int, price: float) -> None:
    """Ajoute un point de prix (ignore silencieusement les doublons de timestamp)."""
    with _connect() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO price_history (pair, ts_ms, price) VALUES (?, ?, ?)",
            (pair, ts_ms, price),
        )


def append_prices_bulk(pair: str, points) -> None:
    """Insère une liste de (ts_ms, price) en une seule transaction (utilisé au bootstrap)."""
    with _connect() as conn:
        conn.executemany(
            "INSERT OR IGNORE INTO price_history (pair, ts_ms, price) VALUES (?, ?, ?)",
            [(pair, ts_ms, price) for ts_ms, price in points],
        )


def load_history(pair: str, limit: int = MAX_HISTORY_POINTS) -> pd.DataFrame:
    """Charge les derniers `limit` points de la paire, triés du plus ancien au plus récent."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ts_ms, price FROM price_history WHERE pair = ? ORDER BY ts_ms DESC LIMIT ?",
            (pair, limit),
        ).fetchall()
    rows.reverse()
    return pd.DataFrame(rows, columns=["ts_ms", "price"])


def trim_history(pair: str, max_points: int = MAX_HISTORY_POINTS) -> None:
    """Supprime les points les plus anciens au-delà de max_points pour borner la taille du fichier."""
    with _connect() as conn:
        conn.execute(
            """
            DELETE FROM price_history
            WHERE pair = ? AND ts_ms NOT IN (
                SELECT ts_ms FROM price_history WHERE pair = ? ORDER BY ts_ms DESC LIMIT ?
            )
            """,
            (pair, pair, max_points),
        )


def count_points(pair: str) -> int:
    with _connect() as conn:
        (n,) = conn.execute("SELECT COUNT(*) FROM price_history WHERE pair = ?", (pair,)).fetchone()
    return n
