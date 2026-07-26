/**
 * État du lien d'invitation du canal VIP (Partie 1) : réutilise la table
 * générique chain_state (clé/valeur) plutôt qu'une nouvelle table pour deux
 * champs. Deux clés : le lien actif, et sa date de création (pour la
 * rotation tous les VIP_INVITE_ROTATION_DAYS jours, voir cron/rotateVipInvite.ts).
 */

import { SupabaseConfig, selectRows, upsertRow } from "../supabaseRest";

const LINK_KEY = "vip_invite_link";
const CREATED_AT_KEY = "vip_invite_created_at";

export interface VipInviteState {
  link: string;
  createdAt: string;
}

export async function getVipInviteState(db: SupabaseConfig): Promise<VipInviteState | null> {
  const rows = await selectRows<{ key: string; value: string }>(db, "chain_state", {
    key: `in.(${LINK_KEY},${CREATED_AT_KEY})`,
  });
  const link = rows.find((r) => r.key === LINK_KEY)?.value;
  const createdAt = rows.find((r) => r.key === CREATED_AT_KEY)?.value;
  return link && createdAt ? { link, createdAt } : null;
}

export async function setVipInviteState(db: SupabaseConfig, link: string, createdAtIso: string): Promise<void> {
  await upsertRow(db, "chain_state", { key: LINK_KEY, value: link }, "key");
  await upsertRow(db, "chain_state", { key: CREATED_AT_KEY, value: createdAtIso }, "key");
}
