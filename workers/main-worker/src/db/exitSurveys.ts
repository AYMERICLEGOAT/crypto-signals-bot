import { SupabaseConfig, insertRow, selectRows } from "../supabaseRest";

export type ExitSurveyReason = "frequency" | "performance" | "price" | "other";

interface ExitSurveyRow {
  reason: ExitSurveyReason;
}

export async function recordExitSurveyResponse(db: SupabaseConfig, telegramId: number, reason: ExitSurveyReason): Promise<void> {
  await insertRow(db, "exit_surveys", { telegram_id: telegramId, reason });
}

/** /stats admin (Bloc 14.2) : répartition des raisons de départ, tous temps confondus. */
export async function getExitSurveyBreakdown(db: SupabaseConfig): Promise<Record<ExitSurveyReason, number>> {
  const rows = await selectRows<ExitSurveyRow>(db, "exit_surveys", { select: "reason" });
  const breakdown: Record<ExitSurveyReason, number> = { frequency: 0, performance: 0, price: 0, other: 0 };
  for (const row of rows) {
    breakdown[row.reason] = (breakdown[row.reason] ?? 0) + 1;
  }
  return breakdown;
}
