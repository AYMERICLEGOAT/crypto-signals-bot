"""
Lit les résultats déjà connus des signaux passés, pour affichage honnête sur
le site — jamais de chiffre inventé.

Audit#5 : ce module RÉSOLVAIT autrefois lui-même les signaux en attente
(vérification de prix via CoinGecko, une fois par jour). Ce rôle est
désormais tenu exclusivement par le Worker Cloudflare
(workers/main-worker/src/cron/trackSignalOutcomes.ts), qui tourne toutes les
5 minutes (Binance) au lieu d'une fois par jour (CoinGecko) — 288x plus
souvent, donc systématiquement plus rapide à résoudre un signal. Les deux
systèmes écrivaient sur les mêmes colonnes (`outcome`, `outcome_price`,
`evaluated_at`) sans se coordonner ; si jamais celui-ci gagnait la course, il
ne posait pas `close_reason` (colonne propre au Worker), si bien que le
Worker ne repassait plus jamais sur ce signal et les abonnés ne recevaient
JAMAIS la notification de clôture — un bug silencieux et permanent, pas
juste un ralentissement. Supprimé plutôt que corrigé : un doublon qui
n'apporte plus rien une fois le Worker en place n'a pas besoin d'exister.
"""

from config import PERFORMANCE_WINDOW_SIZE
import supabase_client


def compute_performance_stats():
    """
    Statistiques réelles calculées sur les derniers signaux résolus
    (PERFORMANCE_WINDOW_SIZE). Retourne un dict prêt à afficher, avec
    total/wins/losses/win_rate — jamais de valeur inventée : si aucun signal
    n'est encore résolu, win_rate vaut None (le site doit l'afficher comme
    "en cours d'évaluation", pas comme 0% ou un chiffre fictif).
    """
    resolved = supabase_client.get_performance_window(PERFORMANCE_WINDOW_SIZE)
    total = len(resolved)
    wins = sum(1 for s in resolved if s["outcome"] == "WIN")
    losses = total - wins
    # Étape 3 (preuve sociale) : trades ayant atteint TP1 (sécurisé au moins
    # au break-even, voir workers/main-worker/src/cron/trackSignalOutcomes.ts)
    # -- compté sur la même fenêtre que le reste, colonne déjà présente sur
    # `signals` (get_performance_window fait un select * implicite).
    secured_count = sum(1 for s in resolved if s.get("tp1_hit_at"))

    return {
        "total": total,
        "wins": wins,
        "losses": losses,
        "win_rate": round(100 * wins / total, 1) if total > 0 else None,
        "secured_count": secured_count,
        "secured_pct": round(100 * secured_count / total, 1) if total > 0 else None,
        "recent": resolved[:10],
    }
