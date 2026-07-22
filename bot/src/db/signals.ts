import { supabase } from "./supabaseClient";

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
}

/** Signaux produits par le module `signals/` (Python) et pas encore diffusés aux abonnés. */
export async function getUnsentSignals(): Promise<SignalRecord[]> {
  const { data, error } = await supabase
    .from("signals")
    .select("*")
    .eq("sent", false)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as SignalRecord[];
}

export async function markSignalSent(id: number): Promise<void> {
  const { error } = await supabase.from("signals").update({ sent: true }).eq("id", id);
  if (error) throw error;
}
