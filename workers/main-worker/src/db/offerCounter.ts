import { SupabaseConfig, selectOne, updateRows } from "../supabaseRest";

const OFFER_NAME = "decouverte";

interface OfferCounterRow {
  offer_name: string;
  slots_total: number;
  slots_used: number;
}

/** Places restantes RÉELLES pour le Pack Découverte (jamais un chiffre décoratif). */
export async function getRemainingDiscoverySlots(db: SupabaseConfig): Promise<number> {
  const row = await selectOne<OfferCounterRow>(db, "offer_counter", { offer_name: `eq.${OFFER_NAME}` });
  if (!row) return 0;
  return Math.max(0, row.slots_total - row.slots_used);
}

/**
 * Incrémente le compteur d'utilisation — à appeler uniquement à la
 * confirmation RÉELLE d'un paiement Découverte (jamais à l'affichage de
 * l'offre), pour que le compteur reflète des places vraiment prises.
 */
export async function incrementDiscoverySlotsUsed(db: SupabaseConfig): Promise<void> {
  const row = await selectOne<OfferCounterRow>(db, "offer_counter", { offer_name: `eq.${OFFER_NAME}` });
  if (!row) return;
  await updateRows(db, "offer_counter", { offer_name: `eq.${OFFER_NAME}` }, { slots_used: row.slots_used + 1 });
}
