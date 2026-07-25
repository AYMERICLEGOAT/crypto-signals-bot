import { SupabaseConfig, selectRows, updateRows } from "../supabaseRest";

export type MomentumAlertKind = "rsi_neutral_exit" | "ema_cross_unconfirmed" | "atr_spike";

export interface MomentumAlertRecord {
  id: number;
  pair: string;
  kind: MomentumAlertKind;
  detail: string;
  created_at: string;
  sent_to_channel: boolean;
}

export async function getUnsentMomentumAlerts(db: SupabaseConfig, limit = 20): Promise<MomentumAlertRecord[]> {
  return selectRows<MomentumAlertRecord>(db, "momentum_alerts", {
    sent_to_channel: "eq.false",
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markMomentumAlertSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "momentum_alerts", { id: `eq.${id}` }, { sent_to_channel: true });
}
