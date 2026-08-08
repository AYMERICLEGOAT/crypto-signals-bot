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
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Aucun paiement en attente.", {
      keyboard: [[{ text: "⭐ Voir les offres", callback_data: "start:subscribe" }]],
    });
    return;
  }

  const label = METHOD_LABEL[latest.method] ?? latest.method;
  const planLabel = isValidPlan(latest.plan) ? PLAN_NAMES[latest.plan] : `Plan ${latest.plan}`;

  if (latest.status === "confirmed") {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `✅ Paiement confirmé — ton abonnement ${planLabel} est actif.`,
      {
        keyboard: [
          [{ text: "🔒 Rejoindre le canal VIP", callback_data: "start:vip" }],
          [{ text: "📊 Voir mon accès", callback_data: "start:status" }],
        ],
      }
    );
    return;
  }

  if (latest.status === "expired") {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `⌛ Ton dernier paiement en attente (${planLabel}, ${label}) a expiré sans être détecté.\n\n` +
        "Si tu as réellement envoyé les fonds, ils ne sont pas perdus : réponds ici et on vérifie à la main.",
      { keyboard: [[{ text: "🔄 Reprendre depuis le début", callback_data: "start:subscribe" }]] }
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
