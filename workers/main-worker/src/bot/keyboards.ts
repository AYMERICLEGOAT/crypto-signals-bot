import { InlineKeyboard } from "../telegram";
import { PaidPlan } from "../payments/plans";

export const startKeyboard: InlineKeyboard = [
  [{ text: "📅 S'abonner", callback_data: "start:subscribe" }],
  [{ text: "🎁 Essai gratuit (3 jours)", callback_data: "start:trial" }],
  [{ text: "📊 Mon statut", callback_data: "start:status" }],
];

/**
 * Ancrage psychologique (Bloc 2.2) : Standard en premier, puis Pro, puis
 * Découverte en dernier avec un compteur RÉEL de places restantes (jamais
 * décoratif — voir db/offerCounter.ts). Si épuisée, l'option n'est plus
 * proposée du tout plutôt que d'afficher "0 places".
 *
 * Audit#19 : `proPlanVisible` (par défaut true, passé à false par
 * subscribe.ts tant que env.PRO_PLAN_VISIBLE !== "true") masque Pro pour
 * simplifier le choix au lancement — sans avantage démontrable tant qu'il
 * n'y a pas assez d'abonnés pour que la priorité de diffusion (Effet
 * Sniper) fasse une vraie différence. Le plan et son fonctionnement restent
 * intacts : c'est une simplification d'affichage, réversible en repassant
 * le flag à "true".
 */
export function buildPlanKeyboard(remainingDiscoverySlots: number, proPlanVisible = true): InlineKeyboard {
  const keyboard: InlineKeyboard = [[{ text: "⭐ Standard — 19 USDT / mois", callback_data: "plan:1" }]];
  if (proPlanVisible) {
    keyboard.push([{ text: "🎯 Pro — 39 USDT / mois", callback_data: "plan:2" }]);
  }
  if (remainingDiscoverySlots > 0) {
    keyboard.push([
      { text: `🚀 Découverte — 5 USDT / 14j (Offre de lancement, ${remainingDiscoverySlots} places restantes)`, callback_data: "plan:3" },
    ]);
  }
  return keyboard;
}

export function paymentMethodKeyboard(plan: PaidPlan): InlineKeyboard {
  return [
    [{ text: "💵 USDT (Polygon)", callback_data: `pay:USDT:${plan}` }],
    [{ text: "🟠 Monero (XMR)", callback_data: `pay:XMR:${plan}` }],
    [{ text: "⚪ Litecoin (LTC)", callback_data: `pay:LTC:${plan}` }],
  ];
}

export const surveyKeyboard: InlineKeyboard = [
  [
    { text: "👍", callback_data: "survey:up" },
    { text: "👎", callback_data: "survey:down" },
  ],
];

/** Bloc 14.2 : enquête de départ, envoyée après confirmation de /cancel. */
export const exitSurveyKeyboard: InlineKeyboard = [
  [{ text: "Signaux pas assez fréquents", callback_data: "exit_survey:frequency" }],
  [{ text: "Pas assez performants", callback_data: "exit_survey:performance" }],
  [{ text: "Trop cher", callback_data: "exit_survey:price" }],
  [{ text: "Autre", callback_data: "exit_survey:other" }],
];
