import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getLatestPaymentAnyStatus } from "../../db/payments";
import { PLAN_NAMES, isValidPlan } from "../../payments/plans";

const METHOD_LABEL: Record<string, string> = { USDT: "USDT (Polygon)", XMR: "Monero", LTC: "Litecoin" };

/**
 * /check_payment — statut du DERNIER paiement initié, pour rassurer un
 * utilisateur qui vient d'envoyer des fonds et ne sait pas où ça en est
 * (évite un double envoi par erreur). Contrairement à /pay (qui ne montre
 * QUE les paiements encore en attente, avec l'adresse à utiliser), celui-ci
 * distingue aussi explicitement "confirmé" de "jamais tenté" -- jamais de
 * nombre de confirmations inventé : ce compte n'est pas suivi en base.
 */
export async function handleCheckPaymentCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const latest = await getLatestPaymentAnyStatus(db, telegramId);

  if (!latest) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Aucun paiement en attente. Utilise /subscribe pour choisir un plan.");
    return;
  }

  const label = METHOD_LABEL[latest.method] ?? latest.method;
  const planLabel = isValidPlan(latest.plan) ? PLAN_NAMES[latest.plan] : `Plan ${latest.plan}`;

  if (latest.status === "confirmed") {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `✅ Paiement confirmé ! Ton abonnement ${planLabel} est actif. Vérifie les détails avec /status.`
    );
    return;
  }

  if (latest.status === "expired") {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `⌛ Ton dernier paiement en attente (${planLabel}, ${label}) a expiré sans être détecté. Utilise /pay pour relancer, ou /subscribe pour repartir de zéro.`
    );
    return;
  }

  // status === "pending"
  const lines = [`⏳ Paiement en attente — ${planLabel}, ${label}.`];
  if (latest.pay_address) lines.push(`Adresse : \`${latest.pay_address}\``);
  if (latest.amount_expected !== null) lines.push(`Montant exact : ${latest.amount_expected}`);
  lines.push("Vérifié automatiquement toutes les 5 minutes — pas besoin de renvoyer un paiement. Utilise /pay pour revoir l'adresse complète.");
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), { markdown: true });
}
