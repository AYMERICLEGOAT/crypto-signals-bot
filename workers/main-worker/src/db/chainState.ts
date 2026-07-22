/**
 * Remplace data/last_block.json (module 2) : un Worker n'a pas de système de
 * fichiers persistant, donc le dernier bloc Polygon traité pour le rattrapage
 * des événements `Subscribed` est stocké dans une petite table clé/valeur Supabase.
 */

import { SupabaseConfig, selectOne, upsertRow } from "../supabaseRest";

const KEY = "last_processed_block";

interface ChainStateRow {
  key: string;
  value: string;
}

export async function getLastProcessedBlock(db: SupabaseConfig): Promise<number | null> {
  const row = await selectOne<ChainStateRow>(db, "chain_state", { key: `eq.${KEY}` });
  return row ? Number(row.value) : null;
}

export async function setLastProcessedBlock(db: SupabaseConfig, blockNumber: number): Promise<void> {
  await upsertRow(db, "chain_state", { key: KEY, value: String(blockNumber) }, "key");
}
