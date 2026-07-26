import { SupabaseConfig, selectRows, updateRows } from "../supabaseRest";

export interface VolatilitySuspensionRecord {
  id: number;
  pair: string;
  atr_pct: number;
  created_at: string;
  sent_to_channel: boolean;
}

/** Bloc 11.3 : suspensions de signal pour volatilité anormale (signals/main.py) pas encore relayées sur le canal public. */
export async function getUnsentVolatilitySuspensions(db: SupabaseConfig, limit = 20): Promise<VolatilitySuspensionRecord[]> {
  return selectRows<VolatilitySuspensionRecord>(db, "volatility_suspensions", {
    sent_to_channel: "eq.false",
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markVolatilitySuspensionSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "volatility_suspensions", { id: `eq.${id}` }, { sent_to_channel: true });
}
