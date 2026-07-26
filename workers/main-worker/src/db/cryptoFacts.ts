import { SupabaseConfig, selectRows, updateRows } from "../supabaseRest";

export interface CryptoFact {
  id: number;
  content: string;
  last_sent_at: string | null;
}

/** Bloc 12.2 : l'anecdote jamais envoyée (last_sent_at IS NULL) la plus ancienne par id, sinon la moins récemment envoyée — même rotation que educational_posts. */
export async function getNextCryptoFact(db: SupabaseConfig): Promise<CryptoFact | null> {
  const rows = await selectRows<CryptoFact>(db, "crypto_facts", {
    order: "last_sent_at.asc.nullsfirst,id.asc",
    limit: "1",
  });
  return rows[0] ?? null;
}

export async function markCryptoFactSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "crypto_facts", { id: `eq.${id}` }, { last_sent_at: new Date().toISOString() });
}

/** Gate "une anecdote par jour" : a-t-on déjà publié une anecdote aujourd'hui (UTC) ? */
export async function hasSentCryptoFactToday(db: SupabaseConfig): Promise<boolean> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const rows = await selectRows<CryptoFact>(db, "crypto_facts", {
    last_sent_at: `gte.${startOfDay.toISOString()}`,
    limit: "1",
  });
  return rows.length > 0;
}
