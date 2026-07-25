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

  if (env.PAYMENT_GUIDE_IMAGE_URL) {
    await sendPhoto(env.TELEGRAM_BOT_TOKEN, telegramId, env.PAYMENT_GUIDE_IMAGE_URL, {
      caption: "Comment payer ton abonnement",
    });
  }

  if (!pending) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Aucun paiement en attente. Utilise /subscribe pour choisir un plan et un moyen de paiement."
    );
    return;
  }

  const label = METHOD_LABEL[pending.method] ?? pending.method;
  const planLabel = isValidPlan(pending.plan) ? PLAN_NAMES[pending.plan] : `Plan ${pending.plan}`;
  const lines = [`Paiement en attente — ${planLabel}, ${label}`];
  if (pending.pay_address) lines.push(`Adresse : \`${pending.pay_address}\``);
  if (pending.amount_expected !== null) lines.push(`Montant exact : ${pending.amount_expected}`);
  lines.push("Confirmation automatique dès réception (vérifiée toutes les 5 minutes).");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), { markdown: true });
}
