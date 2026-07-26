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
  sent_to_standard: boolean;
  outcome: "WIN" | "LOSS" | null;
  outcome_price: number | null;
  close_reason: "tp_hit" | "sl_hit" | "expired" | null;
  confidence_score: number | null;
}

export async function getUnsentSignals(db: SupabaseConfig): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", { sent: "eq.false", order: "created_at.asc" });
}

export async function markSignalSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { sent: true });
}

/**
 * Signaux déjà envoyés à la vitesse "Pro" (immédiate), plus vieux que
 * `olderThanMinutes` (délai de l'Effet Sniper — Bloc 2.2), pas encore
 * diffusés aux abonnés Standard/Découverte.
 */
export async function getSignalsDueForStandardTier(
  db: SupabaseConfig,
  olderThanMinutes: number,
  limit = 20
): Promise<SignalRecord[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
  return selectRows<SignalRecord>(db, "signals", {
    sent_to_standard: "eq.false",
    created_at: `lte.${cutoff}`,
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markSentToStandard(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { sent_to_standard: true });
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

/**
 * Signaux déjà envoyés (au moins aux abonnés Pro/essai) et pas encore
 * résolus (Bloc 4 — suivi post-trade). Filtre aussi sur `outcome=is.null` en
 * plus de `close_reason` : le site SEO (website/outcome_evaluator.py) peut
 * résoudre un signal en premier (rare, cadence quotidienne vs 5 min ici) —
 * dans ce cas `outcome` est déjà posé et on ne doit pas le réévaluer, même
 * si `close_reason` (propre à ce Worker) est resté vide.
 */
export async function getOpenSignals(db: SupabaseConfig): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", {
    sent: "eq.true",
    outcome: "is.null",
    order: "created_at.asc",
  });
}

/** Bloc 9 — y a-t-il eu un vrai signal dans les `hours` dernières heures ? (statut "aucun signal aujourd'hui"). */
export async function hasRecentSignal(db: SupabaseConfig, hours: number): Promise<boolean> {
  const threshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await selectRows<{ id: number }>(db, "signals", {
    created_at: `gte.${threshold}`,
    select: "id",
    limit: "1",
  });
  return rows.length > 0;
}

/** Bloc 12.3 — récap hebdomadaire : signaux émis depuis `sinceIso`. */
export async function getSignalsCreatedSince(db: SupabaseConfig, sinceIso: string): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", { created_at: `gte.${sinceIso}`, select: "id" });
}

/** Bloc 12.3 — récap hebdomadaire : signaux résolus (TP/SL/expiré) depuis `sinceIso`. */
export async function getSignalsResolvedSince(db: SupabaseConfig, sinceIso: string): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", {
    evaluated_at: `gte.${sinceIso}`,
    outcome: "not.is.null",
    select: "type,entry_price,outcome_price,close_reason",
  });
}

export async function markSignalClosed(
  db: SupabaseConfig,
  id: number,
  outcome: { outcome: "WIN" | "LOSS"; outcomePrice: number | null; closeReason: "tp_hit" | "sl_hit" | "expired" }
): Promise<void> {
  const now = new Date().toISOString();
  await updateRows(
    db,
    "signals",
    { id: `eq.${id}` },
    {
      outcome: outcome.outcome,
      outcome_price: outcome.outcomePrice,
      close_reason: outcome.closeReason,
      evaluated_at: now,
      last_status_update_at: now,
    }
  );
}
