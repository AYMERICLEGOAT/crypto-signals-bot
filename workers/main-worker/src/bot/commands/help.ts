import { Env } from "../../env";
import { sendMessage } from "../../telegram";

/** Audit#8 : liste centralisée des commandes — 13 commandes existaient sans qu'aucune ne les récapitule. */
export async function handleHelpCommand(env: Env, telegramId: number): Promise<void> {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📖 *Commandes disponibles*\n\n" +
      "*Abonnement*\n" +
      "/subscribe — voir les offres et s'abonner\n" +
      "/trial — essai gratuit de 3 jours (une fois par wallet)\n" +
      "/status — vérifier ton abonnement en cours\n" +
      "/pay — rappeler le paiement en attente\n" +
      "/code CODE — appliquer un code promo\n" +
      "/cancel — arrêter les relances (ton accès déjà payé reste valable jusqu'à expiration)\n\n" +
      "*Signaux*\n" +
      "/demo — voir un exemple de signal (issu du backtest)\n" +
      "/history — tes 5 derniers signaux reçus et leur résultat\n\n" +
      "*Parrainage*\n" +
      "/referral — ton lien de parrainage et ta progression\n\n" +
      "*Confiance*\n" +
      "/trust — nombre réel d'abonnés payants actifs, en direct\n\n" +
      "*Tes données*\n" +
      "/delete_my_data — supprimer tes données personnelles (RGPD)\n\n" +
      "*Aide*\n" +
      "/help — cette liste",
    { markdown: true }
  );
}
