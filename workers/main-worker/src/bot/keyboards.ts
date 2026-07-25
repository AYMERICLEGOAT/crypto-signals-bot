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
 */
export function buildPlanKeyboard(remainingDiscoverySlots: number): InlineKeyboard {
  const keyboard: InlineKeyboard = [
    [{ text: "⭐ Standard — 19 USDT / mois", callback_data: "plan:1" }],
    [{ text: "🎯 Pro — 39 USDT / mois", callback_data: "plan:2" }],
  ];
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
