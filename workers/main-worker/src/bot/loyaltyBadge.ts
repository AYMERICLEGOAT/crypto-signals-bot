import { UserRecord } from "../db/users";

/**
 * Badges de fidélité, affichés dans /status, /history et /myperformance.
 *
 * Ils reposent sur l'ancienneté depuis le premier paiement confirmé
 * (plan_started_at, jamais écrasé — voir db/users.ts). C'est le temps écoulé
 * depuis ce premier paiement, pas un cumul exact des périodes réellement
 * actives : le projet n'a pas de registre séparé des interruptions, et l'usage
 * est cohérent avec le reste du code (satisfactionSurvey.ts fait le même).
 *
 * LE RANG DE FONDATEUR, ajouté le 08/08/2026, et pourquoi il compte.
 *
 * Les deux badges existants demandaient trois et six mois d'ancienneté. Un
 * produit qui compte aujourd'hui deux comptes et un seul payeur ne récompensait
 * donc RIEN : les premiers abonnés — ceux qui prennent le risque de payer un
 * service sans historique public, sans avis, sans personne d'autre — n'avaient
 * aucune reconnaissance avant trois mois.
 *
 * Le rang de Fondateur est attribué aux FOUNDER_MAX premiers payeurs, et il est
 * définitif. Ce n'est pas un artifice de rareté : c'est le seul badge que le
 * produit puisse honnêtement décerner aujourd'hui, et il désigne un fait
 * vérifiable — être arrivé avant les autres.
 *
 * Il repose sur `founder_rank`, figé une fois pour toutes au premier paiement
 * (voir db/users.ts). Le recalculer à la volée serait faux : quelqu'un qui
 * s'interrompt puis revient perdrait un rang qu'il a réellement occupé.
 */

const VETERAN_DAYS = 180; // ~6 mois
const CONFIRMED_TRADER_DAYS = 90; // ~3 mois

/**
 * Nombre de rangs de Fondateur. Cinquante : assez pour couvrir toute la phase
 * où s'abonner relève de la confiance plutôt que de la preuve, assez peu pour
 * que le titre veuille encore dire quelque chose.
 */
export const FOUNDER_MAX = 50;

export function getLoyaltyBadge(user: Pick<UserRecord, "plan_started_at" | "founder_rank">): string | null {
  // Le rang de Fondateur passe AVANT l'ancienneté : il est définitif et plus
  // distinctif. Afficher « Vétéran » à un fondateur reviendrait à remplacer un
  // titre unique par un titre que tout le monde finit par obtenir.
  if (user.founder_rank && user.founder_rank <= FOUNDER_MAX) {
    return `🏛️ Fondateur #${user.founder_rank}`;
  }

  if (!user.plan_started_at) return null;
  const daysSinceStart = (Date.now() - new Date(user.plan_started_at).getTime()) / (24 * 60 * 60 * 1000);

  if (daysSinceStart >= VETERAN_DAYS) return "🏅 Vétéran";
  if (daysSinceStart >= CONFIRMED_TRADER_DAYS) return "⭐ Trader confirmé";
  return null;
}
