import { SupabaseConfig, selectRows, insertRow, updateRows } from "../supabaseRest";

export interface LuckyVipDraw {
  id: number;
  telegram_id: number;
  granted_at: string;
  expires_at: string;
  previous_plan: number | null;
  reverted: boolean;
}

/** Gate "un tirage par jour" : y a-t-il déjà eu un Lucky VIP Day aujourd'hui (UTC) ? */
export async function hasDrawnVipToday(db: SupabaseConfig): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await selectRows<LuckyVipDraw>(db, "lucky_vip_draws", {
    granted_at: `gte.${startOfDay.toISOString()}`,
    limit: "1",
  });
  return rows.length > 0;
}

/**
 * previousPlan (Bloc 10) : le plan du gagnant AVANT le passage en VIP, pour
 * pouvoir le restaurer une fois les 24h écoulées (cron/revertLuckyVip.ts) —
 * sans ça, un gagnant dont l'essai sous-jacent dure encore au-delà du VIP
 * garderait le plan Pro indéfiniment.
 */
export async function recordVipDraw(db: SupabaseConfig, telegramId: number, expiresAt: Date, previousPlan: number): Promise<void> {
  await insertRow(db, "lucky_vip_draws", {
    telegram_id: telegramId,
    expires_at: expiresAt.toISOString(),
    previous_plan: previousPlan,
  });
}

/** Tirages dont le VIP a expiré et qui n'ont pas encore été traités par le cron de revert. */
export async function getDueLuckyVipReverts(db: SupabaseConfig): Promise<LuckyVipDraw[]> {
  return selectRows<LuckyVipDraw>(db, "lucky_vip_draws", {
    expires_at: `lte.${new Date().toISOString()}`,
    reverted: "eq.false",
  });
}

export async function markLuckyVipReverted(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "lucky_vip_draws", { id: `eq.${id}` }, { reverted: true });
}
