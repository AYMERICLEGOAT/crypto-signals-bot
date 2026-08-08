import { Env, dbConfig } from "../../env";
import { sendMessage, sendPhoto } from "../../telegram";
import { getLatestPendingPaymentAnyMethod } from "../../db/payments";
import { PLAN_NAMES, isValidPlan } from "../../payments/plans";

const METHOD_LABEL: Record<string, string> = { USDT: "USDT (Polygon)", XMR: "Monero", LTC: "Litecoin" };

/**
 * Rappelle le paiement en cours (adresse + montant) accompagné du guide
 * visuel. N'invente rien : si aucun paiement n'est en attente, renvoie vers
 * /subscribe plutôt que d'afficher une adresse obsolète.
 */
export async function handlePayCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const pending = await getLatestPendingPaymentAnyMethod(db, telegramId);

  // L'IMAGE PART APRÈS LA VÉRIFICATION, PAS AVANT.
  //
  // Elle était envoyée systématiquement : quelqu'un sans paiement en cours
  // recevait un guide de paiement illustré, puis « aucun paiement en attente ».
  // Deux messages, dont un qui ne sert à rien et qui contredit l'autre.
  if (!pending) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Aucun paiement en attente.\n\nSi tu veux t'abonner, le bouton ci-dessous ouvre les offres.",
      { keyboard: [[{ text: "⭐ Voir les offres", callback_data: "start:subscribe" }]] }
    );
    return;
  }

  if (env.PAYMENT_GUIDE_IMAGE_URL) {
    await sendPhoto(env.TELEGRAM_BOT_TOKEN, telegramId, env.PAYMENT_GUIDE_IMAGE_URL, {
      caption: "Comment payer ton abonnement",
    });
  }

  const label = METHOD_LABEL[pending.method] ?? pending.method;
  const planLabel = isValidPlan(pending.plan) ? PLAN_NAMES[pending.plan] : `Plan ${pending.plan}`;
  const lines = [`Paiement en attente — ${planLabel}, ${label}`];
  if (pending.pay_address) lines.push(`Adresse : \`${pending.pay_address}\``);
  if (pending.amount_expected !== null) lines.push(`Montant exact : ${pending.amount_expected}`);
  // Bloc 15.2 : lien litecoin: cliquable (adresse + montant préremplis) -- seul ce schéma d'URI a un sens ici (pas de standard équivalent largement supporté pour USDT/Polygon ou Monero).
  if (pending.method === "LTC" && pending.pay_address && pending.amount_expected !== null) {
    lines.push(`📱 [Ouvrir directement dans ton wallet](litecoin:${pending.pay_address}?amount=${pending.amount_expected})`);
  }
  lines.push("Confirmation automatique dès réception (vérifiée toutes les 5 minutes).");
  lines.push("Rien à renvoyer, rien à signaler : l'accès s'ouvre tout seul.");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), {
    markdown: true,
    keyboard: [[{ text: "📘 Guide de paiement complet", callback_data: "pay:guide" }]],
  });
}
