"""
Sauvegarde hebdomadaire de la base Supabase (voir .github/workflows/backup.yml,
tous les lundis à 3h UTC) : Supabase ne propose aucun backup automatique sur
le plan gratuit (ni quotidien, ni PITR — ces fonctions sont réservées aux
plans payants), donc rien ne protège les données du bot contre une perte
accidentelle sans ce script.

⚠️ Séparation volontaire en deux groupes, jamais mélangés :
  - PUBLIC_TABLES : aucune donnée personnelle (pas de telegram_id, wallet,
    adresse de paiement). Écrites dans backups/public/ et COMMITÉES dans le
    dépôt (public sur GitHub) par le workflow.
  - SENSITIVE_TABLES : contiennent des identifiants Telegram et/ou des
    adresses de paiement (users, pending_payments, litecoin_address_pool,
    signal_deliveries, etc.). Écrites dans backups/private/, qui n'est
    JAMAIS commité (voir .gitignore) — le workflow les envoie uniquement en
    artefact GitHub Actions privé (accès restreint aux collaborateurs du
    dépôt, expire automatiquement).
  Committer les tables sensibles dans un dépôt public exposerait
  définitivement les wallets et identifiants de tous les abonnés dans
  l'historique git, y compris ceux ayant déjà demandé /delete_my_data —
  l'exact inverse de la promesse RGPD du projet. Ne jamais fusionner les
  deux listes ci-dessous, même pour simplifier le script.
"""

import json
import logging
import os
from datetime import datetime, timezone

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BACKUP_DIR = os.path.join(os.path.dirname(__file__), "backups")
PUBLIC_DIR = os.path.join(BACKUP_DIR, "public")
PRIVATE_DIR = os.path.join(BACKUP_DIR, "private")

PAGE_SIZE = 1000  # limite par page PostgREST/supabase-py (.range est inclusif)

# Aucune colonne telegram_id / wallet / adresse de paiement.
PUBLIC_TABLES = [
    "signals",
    "strategy_params",
    "backtest_trades",
    "educational_posts",
    "promo_codes",
    "daily_stats",
    "signal_pause",
    "momentum_alerts",
    "leaderboard_posts",
    "system_heartbeats",
    "no_signal_status_posts",
    "volatility_suspensions",
    "crypto_facts",
    "fear_greed_posts",
    "weekly_recap_posts",
    "offer_counter",
    "chain_state",
    "posted_content",
]

# Contiennent un telegram_id et/ou une adresse (wallet/paiement) -- jamais commitées publiquement.
SENSITIVE_TABLES = [
    "users",
    "pending_payments",
    "pending_actions",
    "litecoin_address_pool",
    "lucky_vip_draws",
    "promo_code_redemptions",
    "signal_deliveries",
    "admin_actions",
    "command_rate_limit",
    "payment_cache",
    "referral_rewards",
    "exit_surveys",
]


def _fetch_all_rows(client, table: str) -> list:
    """Récupère TOUTES les lignes d'une table par pages de PAGE_SIZE (jamais tronqué au-delà de 1000)."""
    rows = []
    start = 0
    while True:
        res = client.table(table).select("*").range(start, start + PAGE_SIZE - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


def _backup_tables(client, tables: list) -> tuple:
    """Retourne (dict table -> lignes, dict table -> message d'erreur) -- une table en échec n'interrompt jamais les autres."""
    dump, errors = {}, {}
    for table in tables:
        try:
            dump[table] = _fetch_all_rows(client, table)
            logger.info("%s: %d ligne(s) sauvegardée(s).", table, len(dump[table]))
        except Exception as exc:
            errors[table] = str(exc)
            logger.warning("Échec de la sauvegarde de %s (table absente ou API indisponible): %s", table, exc)
    return dump, errors


def _write_backup(directory: str, label: str, dump: dict, errors: dict, timestamp: str) -> str:
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"backup_{label}_{timestamp}.json")
    payload = {
        "generated_at": timestamp,
        "tables": dump,
        "errors": errors,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, default=str)
    return path


def main() -> int:
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("SUPABASE_URL / SUPABASE_KEY manquants -- impossible de lancer la sauvegarde.")
        return 1

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

    public_dump, public_errors = _backup_tables(client, PUBLIC_TABLES)
    sensitive_dump, sensitive_errors = _backup_tables(client, SENSITIVE_TABLES)

    public_path = _write_backup(PUBLIC_DIR, "public", public_dump, public_errors, timestamp)
    private_path = _write_backup(PRIVATE_DIR, "private", sensitive_dump, sensitive_errors, timestamp)
    logger.info("Sauvegarde publique: %s", public_path)
    logger.info("Sauvegarde privée (jamais commitée, voir .gitignore): %s", private_path)

    total_tables = len(PUBLIC_TABLES) + len(SENSITIVE_TABLES)
    total_errors = len(public_errors) + len(sensitive_errors)
    if total_errors == total_tables:
        logger.error("Échec de la sauvegarde de TOUTES les tables (%d/%d) -- Supabase probablement indisponible.", total_errors, total_tables)
        return 1
    if total_errors:
        # Corrigé (29/07) : un échec PARTIEL (ex: seulement `users`, la table
        # la plus sensible/précieuse -- voir SENSITIVE_TABLES ci-dessus) ne
        # provoquait jusqu'ici qu'un warning, sans faire échouer le job ni
        # déclencher l'alerte Telegram de .github/workflows/backup.yml (qui
        # ne se déclenche que sur `failure()`). backup.yml étant documenté
        # comme la SEULE sauvegarde réelle des données (pas de PITR/backup
        # automatique côté Supabase gratuit), toute table manquante -- même
        # une seule -- mérite une alerte, pas seulement une panne totale.
        all_errors = {**public_errors, **sensitive_errors}
        logger.error(
            "%d/%d table(s) NON sauvegardée(s) ce cycle : %s",
            total_errors, total_tables, ", ".join(all_errors.keys()),
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
