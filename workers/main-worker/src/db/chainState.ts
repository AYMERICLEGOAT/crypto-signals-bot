/**
 * Remplace data/last_block.json (module 2) : un Worker n'a pas de système de
 * fichiers persistant, donc le dernier bloc Polygon traité pour un rattrapage
 * donné (événements du contrat, transferts USDT...) est stocké dans une
 * petite table clé/valeur Supabase. `key` permet de garder plusieurs
 * checkpoints indépendants (un par mécanisme de surveillance).
 */

import { SupabaseConfig, selectOne, upsertRow } from "../supabaseRest";

const DEFAULT_KEY = "last_processed_block";

interface ChainStateRow {
  key: string;
  value: string;
}

export async function getLastProcessedBlock(db: SupabaseConfig, key: string = DEFAULT_KEY): Promise<number | null> {
  const row = await selectOne<ChainStateRow>(db, "chain_state", { key: `eq.${key}` });
  return row ? Number(row.value) : null;
}

export async function setLastProcessedBlock(db: SupabaseConfig, blockNumber: number, key: string = DEFAULT_KEY): Promise<void> {
  await upsertRow(db, "chain_state", { key, value: String(blockNumber) }, "key");
}
