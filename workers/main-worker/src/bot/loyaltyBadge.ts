import { UserRecord } from "../db/users";

/**
 * Bloc 14.1 : badges de fidélité basés sur l'ancienneté depuis le premier
 * paiement confirmé (plan_started_at, jamais écrasé — voir db/users.ts).
 * Mesure le temps écoulé depuis ce premier paiement, pas un cumul exact des
 * périodes réellement actives (le projet n'a pas de registre séparé des
 * interruptions) — cohérent avec l'usage déjà fait de ce champ ailleurs
 * (ex: satisfactionSurvey.ts) pour estimer l'ancienneté d'un abonné.
 */
const VETERAN_DAYS = 180; // ~6 mois
const CONFIRMED_TRADER_DAYS = 90; // ~3 mois

export function getLoyaltyBadge(user: Pick<UserRecord, "plan_started_at">): string | null {
  if (!user.plan_started_at) return null;
  const daysSinceStart = (Date.now() - new Date(user.plan_started_at).getTime()) / (24 * 60 * 60 * 1000);

  if (daysSinceStart >= VETERAN_DAYS) return "🏅 Vétéran";
  if (daysSinceStart >= CONFIRMED_TRADER_DAYS) return "⭐ Trader confirmé";
  return null;
}
