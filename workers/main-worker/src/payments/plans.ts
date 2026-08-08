/**
 * Grille tarifaire (Bloc 2) :
 *   1 = Mensuel    — 19 USDT / 30 jours
 *   2 = Trimestriel — 45 USDT / 90 jours, soit 15 USDT par mois
 *   3 = Découverte  — 5 USDT / 14 jours (offre de lancement, limitée, une fois par wallet)
 *   4 = À vie       — 99 USDT, JAMAIS proposé à un nouveau venu (voir LIFETIME_PLAN)
 *
 * Le plan 0 (essai gratuit) reste géré séparément (bot/commands/trial.ts).
 */

export type PaidPlan = 1 | 2 | 3 | 4;

/**
 * LES PALIERS VENDENT DE LA DURÉE, PLUS DE LA VITESSE (08/08/2026).
 *
 * Le plan Pro coûtait 39 USDT contre 19 — le double — et sa seule différence
 * était de recevoir les signaux quinze minutes plus tôt. Sur une stratégie dont
 * la position se ferme au bout de trois à vingt-et-un jours, quinze minutes ne
 * valent rien. C'était exactement le défaut du canal gratuit, un étage plus
 * haut : vendre de la vitesse sur un produit dont l'horizon la rend sans
 * valeur. Le plan n'était heureusement pas affiché (PRO_PLAN_VISIBLE), mais le
 * code existait et pouvait l'être.
 *
 * LA DURÉE, ELLE, EST UN VRAI AXE — et le seul aligné sur ce que fait la
 * stratégie. Le filtre de tendance est fermé 41 % du temps, jusqu'à 381 jours
 * d'affilée : un abonnement de 30 jours peut ne rien contenir, et c'est écrit
 * dans les CGV. Un abonné mensuel qui tombe sur un mois creux part et ne
 * revient pas ; un abonné trimestriel traverse le creux et voit la reprise.
 *
 * Vendre des mois quand la stratégie se juge en mois n'est pas une astuce
 * commerciale : c'est la seule durée à laquelle le produit peut être évalué
 * honnêtement. Le trimestre revient à 15 USDT par mois, soit -21 %.
 */
export const PLAN_PRICES_USD: Record<PaidPlan, number> = { 1: 19, 2: 45, 3: 5, 4: 99 };
// L'accès à vie est posé à 100 ans : la même mécanique d'expiration continue
// de fonctionner sans cas particulier, et personne n'atteindra la date.
export const PLAN_DURATION_DAYS: Record<PaidPlan, number> = { 1: 30, 2: 90, 3: 14, 4: 36500 };
export const PLAN_NAMES: Record<PaidPlan, string> = { 1: "Mensuel", 2: "Trimestriel", 3: "Découverte", 4: "À vie" };

export const DISCOVERY_PLAN: PaidPlan = 3;
export const PRO_PLAN: PaidPlan = 2;
export const STANDARD_PLAN: PaidPlan = 1;

/**
 * L'ACCÈS À VIE N'EST PAS UNE OFFRE D'ACQUISITION.
 *
 * Vendre 99 USDT à quelqu'un qui découvre le produit serait malhonnête sur
 * deux plans à la fois : il n'a aucun moyen de juger, et le filtre de tendance
 * peut rester fermé un an — il paierait un accès permanent à un service qu'il
 * n'a pas encore vu fonctionner.
 *
 * Il est donc réservé à quelqu'un qui a DÉJÀ payé et tenu au moins un mois :
 * cette personne sait ce qu'elle achète, elle a traversé au moins un cycle, et
 * lui proposer de ne plus jamais repayer est une récompense, pas une vente.
 *
 * Il n'apparaît nulle part ailleurs : ni dans /subscribe pour un nouveau venu,
 * ni sur le site, ni dans les messages d'accueil.
 */
export const LIFETIME_PLAN: PaidPlan = 4;

/** Ancienneté payante minimale avant que l'accès à vie soit proposé. */
export const LIFETIME_MIN_DAYS_PAID = 30;

export function isValidPlan(value: number): value is PaidPlan {
  return value === 1 || value === 2 || value === 3 || value === 4;
}
