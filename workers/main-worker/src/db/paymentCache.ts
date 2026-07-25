import { SupabaseConfig, selectOne, upsertRow } from "../supabaseRest";

/**
 * Cache de vérification de paiement (Bloc 8) — idempotence par tx_hash,
 * indépendante du checkpoint par bloc (db/chainState.ts). Le checkpoint
 * empêche déjà de RE-SCANNER une plage de blocs, mais si jamais il était
 * réinitialisé ou décalé (reprise après incident, relance manuelle), ce
 * cache empêche de retraiter une transaction déjà vue — pas une seconde
 * ligne de défense décorative, une vraie garde-fou en cas de recouvrement.
 */
export async function isTxCached(db: SupabaseConfig, txHash: string): Promise<boolean> {
  const row = await selectOne(db, "payment_cache", { tx_hash: `eq.${txHash}` });
  return row !== null;
}

export async function cacheTxResult(db: SupabaseConfig, txHash: string, verifiedResult: boolean): Promise<void> {
  await upsertRow(db, "payment_cache", { tx_hash: txHash, verified_result: verifiedResult }, "tx_hash");
}
