/**
 * Le Worker ne dérive PAS d'adresses Litecoin lui-même : bitcoinjs-lib/bip32
 * (testé empiriquement) ne fonctionnent pas sous workerd (dépendances Node
 * historiques incompatibles — voir README). À la place, un pool d'adresses
 * est pré-généré hors-ligne avec l'outillage Node du module 2
 * (scripts/generate-litecoin-pool.ts) et stocké dans Supabase ; le Worker se
 * contente de "réserver" une adresse jamais utilisée du pool.
 *
 * La réservation passe par une fonction SQL (claim_litecoin_address, voir
 * schema.sql) plutôt qu'un SELECT + UPDATE séparés, pour éviter qu'une course
 * entre deux requêtes concurrentes ne réserve deux fois la même adresse.
 */

import { SupabaseConfig, callRpc } from "../supabaseRest";

export interface ClaimedLitecoinAddress {
  address: string;
  hd_index: number;
}

/** Retourne null si le pool est épuisé (voir README pour le réapprovisionner). */
export async function claimLitecoinAddress(db: SupabaseConfig, telegramId: number): Promise<ClaimedLitecoinAddress | null> {
  const rows = await callRpc<ClaimedLitecoinAddress[]>(db, "claim_litecoin_address", { p_telegram_id: telegramId });
  return rows?.[0] ?? null;
}
