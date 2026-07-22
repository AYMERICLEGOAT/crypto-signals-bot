"""
Évalue honnêtement les résultats des signaux passés : au lieu d'inventer des
chiffres de performance pour le site, on vérifie le prix courant de chaque
signal encore "non résolu" et on détermine s'il a atteint son take profit
(gagné) ou son stop loss (perdu).

Limite assumée et documentée (plutôt que cachée) : on compare au prix
COURANT (un instantané), pas à l'historique intrabar complet. Un signal qui
aurait touché son take profit puis serait redescendu avant notre vérification
serait donc compté correctement (dès qu'il touche le TP on le marque WIN,
avant que le prix ne redescende), mais un signal qui aurait brièvement touché
son stop loss puis serait remonté sans qu'on l'ait vérifié à ce moment-là
pourrait être mal classé. Sur des signaux vérifiés quotidiennement avec des
seuils de ±2-4%, cette approximation reste raisonnable pour un site de
contenu, mais ce n'est pas un calcul de performance de qualité "audit".
"""

from datetime import datetime, timezone

from config import PAIRS, EVAL_TIMEOUT_DAYS, PERFORMANCE_WINDOW_SIZE
import supabase_client
import coingecko_client


def _parse_timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _evaluate_against_price(signal, current_price):
    """Retourne 'WIN', 'LOSS', ou None si ni le take profit ni le stop loss n'ont été atteints."""
    entry = float(signal["entry_price"])
    stop_loss = float(signal["stop_loss"])
    take_profit = float(signal["take_profit"])
    side = signal["type"]

    if side == "BUY":
        if current_price >= take_profit:
            return "WIN"
        if current_price <= stop_loss:
            return "LOSS"
    else:  # SELL
        if current_price <= take_profit:
            return "WIN"
        if current_price >= stop_loss:
            return "LOSS"
    return None


def resolve_pending_signals():
    """
    Récupère les signaux sans résultat connu, vérifie leur prix courant, et
    met à jour Supabase pour ceux qui ont atteint leur take profit ou stop
    loss (ou qui ont expiré sans les atteindre -> comptés comme perte, même
    convention conservatrice que le backtest du module signals/).
    """
    # Fenêtre large : le timeout précis est géré signal par signal ci-dessous.
    pending = supabase_client.get_unresolved_signals(max_age_days=EVAL_TIMEOUT_DAYS * 3)
    if not pending:
        print("Aucun signal en attente d'évaluation.")
        return 0

    coin_ids = [PAIRS[s["pair"]] for s in pending if s["pair"] in PAIRS]
    prices = coingecko_client.get_current_prices(coin_ids)

    now = datetime.now(timezone.utc)
    resolved_count = 0

    for signal in pending:
        coin_id = PAIRS.get(signal["pair"])
        current_price = prices.get(coin_id) if coin_id else None
        created_at = _parse_timestamp(signal["created_at"])
        age_days = (now - created_at).total_seconds() / 86400

        outcome = _evaluate_against_price(signal, current_price) if current_price is not None else None

        if outcome is None and age_days >= EVAL_TIMEOUT_DAYS:
            outcome = "LOSS"  # expiré sans avoir touché SL ni TP

        if outcome:
            supabase_client.update_signal_outcome(signal["id"], outcome, current_price)
            resolved_count += 1
            print(f"Signal #{signal['id']} ({signal['pair']} {signal['type']}) -> {outcome}")

    print(f"{resolved_count} signal(s) résolu(s) sur {len(pending)} en attente.")
    return resolved_count


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

    return {
        "total": total,
        "wins": wins,
        "losses": losses,
        "win_rate": round(100 * wins / total, 1) if total > 0 else None,
        "recent": resolved[:10],
    }
