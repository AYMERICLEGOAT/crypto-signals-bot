import { SupabaseConfig, selectRows, insertRow } from "../supabaseRest";

export interface LuckyVipDraw {
  id: number;
  telegram_id: number;
  granted_at: string;
  expires_at: string;
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

export async function recordVipDraw(db: SupabaseConfig, telegramId: number, expiresAt: Date): Promise<void> {
  await insertRow(db, "lucky_vip_draws", {
    telegram_id: telegramId,
    expires_at: expiresAt.toISOString(),
  });
}
