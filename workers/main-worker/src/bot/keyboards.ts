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

/**
 * Premier message : voir un signal d'abord, essayer ensuite.
 *
 * L'ordre n'est pas anodin. « Voir un vrai signal » ne demande strictement
 * rien ; l'essai, lui, suppose d'avoir rejoint le canal public et de fournir
 * une adresse de wallet (voir commands/trial.ts). Mettre la demande avant la
 * démonstration, c'est demander un effort à quelqu'un qui n'a pas encore vu ce
 * qu'il achète.
 */
export function buildStartMessage1Keyboard(showTrial: boolean): InlineKeyboard {
  const rows: InlineKeyboard = [[{ text: "📈 Voir un vrai signal", callback_data: "start:demo" }]];
  if (showTrial) rows.push([trialCtaButton()]);
  return rows;
}

/** Deuxième message (+3s) : /demo et /trial en boutons cliquables, voir commands/start.ts. */
export function buildStartMessage2Keyboard(showTrial: boolean): InlineKeyboard {
  const rows: InlineKeyboard = [[{ text: "📈 /demo — voir un exemple", callback_data: "start:demo" }]];
  if (showTrial) rows.push([{ text: "🎁 Essai gratuit — 3 jours", callback_data: "start:trial" }]);
  return rows;
}

/**
 * Troisième message (+10s) : /help, le parrainage, et l'essai rappelé une
 * dernière fois.
 *
 * Le parrainage figure ici et nulle part ailleurs dans la séquence : c'est le
 * seul moment où l'utilisateur a vu de quoi il s'agit et peut donc avoir envie
 * d'en parler. Proposé au premier écran, il demanderait de recommander un
 * produit qu'on n'a pas encore regardé.
 */
export function buildStartMessage3Keyboard(showTrial: boolean): InlineKeyboard {
  const rows: InlineKeyboard = [
    [{ text: "❓ /help — toutes les commandes", callback_data: "start:help" }],
    [{ text: "🤝 Parrainer et gagner des jours", callback_data: "start:referral" }],
  ];
  if (showTrial) rows.push([trialCtaButton()]);
  return rows;
}

/**
 * Les trois paliers, du plus engageant au moins engageant.
 *
 * L'ordre place le TRIMESTRIEL en premier depuis le 08/08/2026, et ce n'est
 * pas un artifice d'ancrage : c'est le palier qui correspond à l'horizon réel
 * de la stratégie. Le filtre de tendance est fermé 41 % du temps, jusqu'à
 * 381 jours d'affilée — un mois isolé peut ne rien contenir sans que rien ne
 * soit cassé, et les CGV le disent. Proposer d'abord la durée sur laquelle le
 * produit peut être jugé honnêtement est le contraire d'une astuce : c'est
 * éviter à quelqu'un d'acheter trente jours et de conclure sur un échantillon
 * qui ne prouve rien.
 *
 * Le palier long était masqué jusqu'ici (`proPlanVisible`) parce que sa seule
 * différence — quinze minutes d'avance — ne valait rien. Il vend maintenant de
 * la durée, à 15 USDT par mois au lieu de 19.
 *
 * Le compteur du pack Découverte est RÉEL (voir db/offerCounter.ts), jamais
 * décoratif. Épuisé, l'option disparaît au lieu d'afficher « 0 places ».
 */
export function buildPlanKeyboard(remainingDiscoverySlots: number, proPlanVisible = true): InlineKeyboard {
  // Prix/durées dérivés de payments/plans.ts (source unique) au lieu de
  // valeurs recopiées à la main : un changement de prix ne pouvait sinon
  // toucher que le message texte de subscribe.ts, pas ces boutons, et
  // l'utilisateur cliquait sur un montant qui ne correspondait plus à celui
  // réellement facturé.
  const keyboard: InlineKeyboard = [];
  if (proPlanVisible) {
    const parMois = Math.round(PLAN_PRICES_USD[PRO_PLAN] / (PLAN_DURATION_DAYS[PRO_PLAN] / 30));
    keyboard.push([
      {
        text: `🎯 Trimestriel — ${PLAN_PRICES_USD[PRO_PLAN]} USDT / ${PLAN_DURATION_DAYS[PRO_PLAN]}j (${parMois} USDT par mois)`,
        callback_data: "plan:2",
      },
    ]);
  }
  keyboard.push([
    { text: `⭐ Mensuel — ${PLAN_PRICES_USD[STANDARD_PLAN]} USDT / ${PLAN_DURATION_DAYS[STANDARD_PLAN]}j`, callback_data: "plan:1" },
  ]);
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
