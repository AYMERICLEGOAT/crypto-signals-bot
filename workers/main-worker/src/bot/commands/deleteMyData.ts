import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, eraseUserPersonalData } from "../../db/users";

/**
 * /delete_my_data [confirm] — droit à l'effacement RGPD (Bloc 7).
 * Voir db/users.ts::eraseUserPersonalData pour la limite assumée sur
 * wallet_address (conservée pour l'anti-abus, annoncée ici honnêtement).
 */
export async function handleDeleteMyDataCommand(env: Env, telegramId: number, rawArgs: string): Promise<void> {
  const confirmed = rawArgs.trim().toLowerCase() === "confirm";

  if (!confirmed) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "⚠️ *Suppression de tes données*\n\n" +
        "Action irréversible : ton parrainage, tes préférences et ton abonnement en cours seront effacés, et tu perdras immédiatement l'accès aux signaux.\n\n" +
        "Ce qui est conservé (jamais utilisé à d'autre fin) :\n" +
        "• Ton adresse wallet — pour la prévention des abus (une offre par wallet)\n" +
        "• Ton historique de paiement — obligation légale/comptable\n" +
        "• Les actions admin te concernant, le cas échéant — traçabilité interne\n\n" +
        "Pour confirmer, envoie /delete\\_my\\_data confirm",
      { markdown: true }
    );
    return;
  }

  const db = dbConfig(env);
  await getOrCreateUser(db, telegramId);
  await eraseUserPersonalData(db, telegramId);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "✅ Tes données personnelles ont été supprimées et ton accès a été révoqué. " +
      "Certaines données transactionnelles peuvent être conservées pour des obligations légales ou anti-fraude."
  );
}
