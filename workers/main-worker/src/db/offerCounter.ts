import { SupabaseConfig, selectOne, callRpc } from "../supabaseRest";

const OFFER_NAME = "decouverte";
const EARLY_ADOPTER_OFFER_NAME = "early_adopter";

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
 *
 * Passe par la fonction SQL increment_offer_slot (UPDATE atomique) plutôt
 * qu'un lire-puis-écrire : deux invocations du cron qui se chevauchent
 * (ex: un appel réseau lent côté paiement) pouvaient sinon lire la même
 * valeur avant que l'une des deux n'écrive, perdant un incrément.
 */
export async function incrementDiscoverySlotsUsed(db: SupabaseConfig): Promise<void> {
  await callRpc(db, "increment_offer_slot", { p_offer_name: OFFER_NAME });
}

/** Bloc 14.3 : mois offert aux 10 premiers abonnés Standard (même table générique que Découverte). */
export async function getRemainingEarlyAdopterSlots(db: SupabaseConfig): Promise<number> {
  const row = await selectOne<OfferCounterRow>(db, "offer_counter", { offer_name: `eq.${EARLY_ADOPTER_OFFER_NAME}` });
  if (!row) return 0;
  return Math.max(0, row.slots_total - row.slots_used);
}

/**
 * Incrémente uniquement à la confirmation RÉELLE d'un paiement Standard,
 * comme incrementDiscoverySlotsUsed. Retourne true si CETTE invocation a
 * réellement obtenu une place (le UPDATE atomique n'affecte aucune ligne si
 * le quota est déjà épuisé) — l'appelant doit se baser sur cette valeur de
 * retour plutôt que sur un getRemainingEarlyAdopterSlots() lu séparément
 * avant, qui laissait une fenêtre de course pouvant créditer le bonus deux
 * fois pour un seul quota (deux invocations qui se chevauchent, voir
 * cron/pollPayments.ts::onPaymentConfirmed).
 */
export async function incrementEarlyAdopterSlotsUsed(db: SupabaseConfig): Promise<boolean> {
  const rows = await callRpc<OfferCounterRow[]>(db, "increment_offer_slot", { p_offer_name: EARLY_ADOPTER_OFFER_NAME });
  return rows.length > 0;
}
