import { SupabaseConfig, selectRows, updateRows } from "../supabaseRest";

export interface SignalRecord {
  id: number;
  pair: string;
  type: "BUY" | "SELL";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  created_at: string;
  sent: boolean;
  chart_url: string | null;
  sent_to_channel: boolean;
}

export async function getUnsentSignals(db: SupabaseConfig): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", { sent: "eq.false", order: "created_at.asc" });
}

export async function markSignalSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { sent: true });
}

/**
 * Signaux déjà envoyés aux abonnés, plus vieux que `olderThanMinutes` (le
 * délai du canal public gratuit), et pas encore diffusés sur ce canal.
 * Limité à `limit` par appel pour ne pas rattraper des centaines de
 * signaux d'un coup si le cron a été arrêté un moment.
 */
export async function getSignalsDueForPublicChannel(
  db: SupabaseConfig,
  olderThanMinutes: number,
  limit = 20
): Promise<SignalRecord[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
  return selectRows<SignalRecord>(db, "signals", {
    sent_to_channel: "eq.false",
    created_at: `lte.${cutoff}`,
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markSentToChannel(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { sent_to_channel: true });
}
