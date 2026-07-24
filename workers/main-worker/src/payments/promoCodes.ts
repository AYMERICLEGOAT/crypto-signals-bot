import { SupabaseConfig, selectOne, insertRow, updateRows } from "../supabaseRest";
import { getUserIfExists } from "../db/users";

interface PromoCode {
  code: string;
  discount_pct: number;
  active: boolean;
}

/**
 * Prix effectif après application du code promo en attente de l'utilisateur
 * (users.pending_promo_code), s'il en a un et qu'il est toujours actif.
 * Ne modifie rien en base : c'est purement un calcul d'affichage/facturation,
 * la consommation réelle du code se fait à la confirmation du paiement
 * (voir consumePendingPromoCode).
 */
export async function getEffectivePriceUsd(db: SupabaseConfig, telegramId: number, basePriceUsd: number): Promise<number> {
  const user = await getUserIfExists(db, telegramId);
  if (!user?.pending_promo_code) return basePriceUsd;

  const promo = await selectOne<PromoCode>(db, "promo_codes", {
    code: `eq.${user.pending_promo_code}`,
    active: "eq.true",
  });
  if (!promo) return basePriceUsd;

  return Math.round(basePriceUsd * (1 - promo.discount_pct / 100) * 100) / 100;
}

/**
 * À appeler après confirmation d'un paiement (voir cron/pollPayments.ts) :
 * enregistre la consommation du code (empêche sa réutilisation par ce même
 * utilisateur) et efface pending_promo_code. Ne fait rien si l'utilisateur
 * n'avait pas de code en attente.
 */
export async function consumePendingPromoCode(db: SupabaseConfig, telegramId: number): Promise<void> {
  const user = await getUserIfExists(db, telegramId);
  if (!user?.pending_promo_code) return;

  try {
    await insertRow(db, "promo_code_redemptions", { code: user.pending_promo_code, telegram_id: telegramId });
  } catch (err) {
    // Contrainte unique(code, telegram_id) déjà satisfaite (double confirmation
    // concurrente sur le même paiement) : sans conséquence, on continue.
    console.warn(`[promoCodes] Échec (probablement bénin) de l'enregistrement de la consommation pour ${telegramId}:`, err);
  }
  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { pending_promo_code: null });
}
