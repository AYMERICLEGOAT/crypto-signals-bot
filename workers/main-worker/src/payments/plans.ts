/**
 * Grille tarifaire (Bloc 2) :
 *   1 = Standard  — 19 USDT / 30 jours
 *   2 = Pro       — 39 USDT / 30 jours (+ Effet Sniper, voir cron/dispatchSignals.ts)
 *   3 = Découverte — 5 USDT / 14 jours (offre de lancement, limitée, une fois par wallet)
 *
 * Le plan 0 (essai gratuit) reste géré séparément (bot/commands/trial.ts).
 */

export type PaidPlan = 1 | 2 | 3;

export const PLAN_PRICES_USD: Record<PaidPlan, number> = { 1: 19, 2: 39, 3: 5 };
export const PLAN_DURATION_DAYS: Record<PaidPlan, number> = { 1: 30, 2: 30, 3: 14 };
export const PLAN_NAMES: Record<PaidPlan, string> = { 1: "Standard", 2: "Pro", 3: "Découverte" };

export const DISCOVERY_PLAN: PaidPlan = 3;
export const PRO_PLAN: PaidPlan = 2;
export const STANDARD_PLAN: PaidPlan = 1;

export function isValidPlan(value: number): value is PaidPlan {
  return value === 1 || value === 2 || value === 3;
}
