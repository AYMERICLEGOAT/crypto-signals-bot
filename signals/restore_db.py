"""
Script de restauration d'un backup produit par backup_db.py (voir
.github/workflows/backup.yml) -- corrige une lacune trouvée par l'audit du
31/07 : la sauvegarde hebdomadaire n'avait jamais de procédure de
restauration testée, seulement un export. Un export qu'on ne sait pas
recharger n'a qu'une valeur limitée en cas de perte réelle de données.

Usage :
  python restore_db.py <chemin_du_backup.json>                # dry-run (rien n'est écrit)
  python restore_db.py <chemin_du_backup.json> --confirm       # restaure réellement (upsert)
  python restore_db.py <chemin_du_backup.json> --confirm --only users,signals

Upsert (pas insert) : rejouer un backup sur une base qui contient déjà
certaines des mêmes lignes (clé primaire identique) met à jour ces lignes
plutôt que d'échouer sur une violation de contrainte -- sûr à relancer
plusieurs fois (idempotent).
"""

import argparse
import json
import logging

from supabase import create_client

from config import SUPABASE_URL, SUPABASE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

BATCH_SIZE = 500  # évite un payload PostgREST trop gros sur les tables volumineuses (ex: backtest_trades)


def restore_table(client, table: str, rows: list, confirm: bool) -> tuple[int, int]:
    """Retourne (lignes traitées, lignes en échec). En dry-run, ne fait aucun appel réseau d'écriture."""
    if not rows:
        return 0, 0

    if not confirm:
        logger.info("[DRY-RUN] %s : %d ligne(s) seraient restaurées (upsert par lots de %d).", table, len(rows), BATCH_SIZE)
        return len(rows), 0

    processed, failed = 0, 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        try:
            client.table(table).upsert(batch).execute()
            processed += len(batch)
        except Exception as exc:
            logger.error("Échec de la restauration du lot [%d:%d] pour %s: %s", i, i + len(batch), table, exc)
            failed += len(batch)
    logger.info("%s : %d ligne(s) restaurée(s), %d échec(s).", table, processed, failed)
    return processed, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("backup_path", help="Chemin du fichier backup_*.json produit par backup_db.py")
    parser.add_argument("--confirm", action="store_true", help="Écrit réellement dans Supabase (sans ce flag : dry-run, aucune écriture)")
    parser.add_argument("--only", help="Restreint aux tables listées, séparées par des virgules (défaut : toutes celles présentes dans le fichier)")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error("SUPABASE_URL / SUPABASE_KEY manquants -- impossible de restaurer.")
        return 1

    with open(args.backup_path, encoding="utf-8") as f:
        payload = json.load(f)

    tables: dict = payload.get("tables", {})
    if not tables:
        logger.error("Aucune table trouvée dans %s (fichier invalide ou vide).", args.backup_path)
        return 1

    only = {t.strip() for t in args.only.split(",")} if args.only else None
    if only:
        unknown = only - set(tables.keys())
        if unknown:
            logger.error("Table(s) demandée(s) absente(s) du backup : %s", ", ".join(sorted(unknown)))
            return 1

    if not args.confirm:
        logger.warning("Mode DRY-RUN (aucune écriture) -- ajoute --confirm pour restaurer réellement.")
    else:
        logger.warning("RESTAURATION RÉELLE en cours vers %s -- ceci va écraser les lignes existantes de même clé primaire.", SUPABASE_URL)

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    total_processed, total_failed = 0, 0
    for table, rows in tables.items():
        if only and table not in only:
            continue
        processed, failed = restore_table(client, table, rows, args.confirm)
        total_processed += processed
        total_failed += failed

    mode = "réellement restaurée(s)" if args.confirm else "seraient restaurée(s) (dry-run)"
    logger.info("Terminé : %d ligne(s) %s au total, %d échec(s).", total_processed, mode, total_failed)
    return 1 if total_failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
