import { InlineKeyboard, InlineKeyboardButton } from "../telegram";
import { PaidPlan, PLAN_PRICES_USD, PLAN_DURATION_DAYS, STANDARD_PLAN, PRO_PLAN, DISCOVERY_PLAN } from "../payments/plans";

/**
 * `showTrial=false` pour un abonné ayant déjà un plan payant actif (Standard/
 * Pro/Découverte) : proposer l'essai gratuit reviendrait à l'inviter à
 * écraser son propre abonnement en cours par 3 jours d'essai (voir
 * bot/commands/trial.ts, handleTrialCommand refuse ce cas). S'applique aux
 * trois claviers de la séquence /start ci-dessous (refonte UX du 01/08/2026).
 */
function trialCtaButton(): InlineKeyboardButton {
  return { text: "🎁 Essai gratuit", callback_data: "start:trial" };
}

/** Premier message de la séquence /start : accroche seule, un unique bouton essai. */
export function buildStartMessage1Keyboard(showTrial: boolean): InlineKeyboard | undefined {
  return showTrial ? [[trialCtaButton()]] : undefined;
}

/** Deuxième message (+3s) : /demo et /trial en boutons cliquables, voir commands/start.ts. */
export function buildStartMessage2Keyboard(showTrial: boolean): InlineKeyboard {
  const rows: InlineKeyboard = [[{ text: "📈 /demo — voir un exemple", callback_data: "start:demo" }]];
  if (showTrial) rows.push([{ text: "🎁 /trial — essai gratuit 3 jours", callback_data: "start:trial" }]);
  return rows;
}

/** Troisième message (+10s) : /help, plus le bouton essai rappelé sur chaque message. */
export function buildStartMessage3Keyboard(showTrial: boolean): InlineKeyboard {
  const rows: InlineKeyboard = [[{ text: "❓ /help — toutes les commandes", callback_data: "start:help" }]];
  if (showTrial) rows.push([trialCtaButton()]);
  return rows;
}

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
  // Prix/durées dérivés de payments/plans.ts (source unique) au lieu de
  // valeurs recopiées à la main : un changement de prix ne pouvait sinon
  // toucher que le message texte de subscribe.ts, pas ces boutons, et
  // l'utilisateur cliquait sur un montant qui ne correspondait plus à celui
  // réellement facturé.
  const keyboard: InlineKeyboard = [
    [{ text: `⭐ Standard — ${PLAN_PRICES_USD[STANDARD_PLAN]} USDT / ${PLAN_DURATION_DAYS[STANDARD_PLAN]}j`, callback_data: "plan:1" }],
  ];
  if (proPlanVisible) {
    keyboard.push([{ text: `🎯 Pro — ${PLAN_PRICES_USD[PRO_PLAN]} USDT / ${PLAN_DURATION_DAYS[PRO_PLAN]}j`, callback_data: "plan:2" }]);
  }
  if (remainingDiscoverySlots > 0) {
    keyboard.push([
      {
        text: `🚀 Découverte — ${PLAN_PRICES_USD[DISCOVERY_PLAN]} USDT / ${PLAN_DURATION_DAYS[DISCOVERY_PLAN]}j (Offre de lancement, ${remainingDiscoverySlots} places restantes)`,
        callback_data: "plan:3",
      },
    ]);
  }
  return keyboard;
}

/**
 * Consentement exprès avant paiement (audit du 01/08/2026, voir
 * commands/subscribe.ts). Un seul bouton d'acceptation : le refus se fait
 * en n'appuyant pas — inutile d'ajouter un bouton "je refuse" qui ne
 * ferait rien de plus que l'inaction.
 */
export function consentKeyboard(plan: PaidPlan): InlineKeyboard {
  return [[{ text: "✅ J'ai compris et j'accepte", callback_data: `consent:${plan}` }]];
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
