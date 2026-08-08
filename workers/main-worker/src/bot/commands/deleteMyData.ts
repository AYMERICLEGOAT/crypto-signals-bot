import { Env, dbConfig } from "../../env";
import { sendMessage, removeChatMember } from "../../telegram";
import { getOrCreateUser, eraseUserPersonalData, isSubscriptionActive } from "../../db/users";

/**
 * /delete_my_data [confirm] — droit à l'effacement RGPD.
 *
 * TROIS CORRECTIONS, dont une portait sur une affirmation FAUSSE.
 *
 * 1. « tu perdras immédiatement l'accès aux signaux » ne l'était pas pour un
 *    membre du canal VIP. Rien ne l'en retirait — aucun appel de retrait
 *    n'existait dans le projet — et ce canal publie chaque matin le point sur
 *    les positions ouvertes, entrées et stops compris. Quelqu'un qui demandait
 *    l'effacement de ses données continuait donc de recevoir la substance du
 *    produit. Le retrait est maintenant effectué ici, et annoncé.
 *
 * 2. L'écran était le même pour tout le monde. Un nouveau venu sans abonnement
 *    lisait qu'on allait effacer « ton abonnement en cours » — inquiétant et
 *    faux. Un abonné payant, lui, n'apprenait ni la date qu'il perdait, ni
 *    l'absence de remboursement, avant une action irréversible.
 *
 * 3. Aucune porte de sortie plus douce n'était proposée. Quelqu'un qui veut
 *    simplement qu'on cesse de lui écrire détruisait un abonnement payé, alors
 *    que /cancel et /prefs répondent exactement à ce besoin. Les nommer ici
 *    n'est pas une manœuvre de rétention : c'est éviter une perte définitive à
 *    quelqu'un qui cherchait autre chose.
 *
 * Voir db/users.ts::eraseUserPersonalData pour la limite assumée sur
 * wallet_address, conservée pour l'anti-abus et annoncée honnêtement.
 */
export async function handleDeleteMyDataCommand(env: Env, telegramId: number, rawArgs: string): Promise<void> {
  const db = dbConfig(env);
  const confirmed = rawArgs.trim().toLowerCase() === "confirm";
  const user = await getOrCreateUser(db, telegramId);
  const actif = isSubscriptionActive(user);

  if (!confirmed) {
    // Ce que la personne perd RÉELLEMENT, avec sa date. Annoncer « ton
    // abonnement en cours » à quelqu'un qui n'en a pas est au mieux inquiétant,
    // au pire un mensonge.
    const ligneAcces = actif
      ? `Ton accès actif jusqu'au ${new Date(user.expiration as string).toLocaleDateString("fr-FR")} sera coupé ` +
        "immédiatement, sans remboursement des jours restants."
      : "Tu n'as pas d'accès actif en ce moment : il n'y a rien à interrompre de ce côté.";

    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "⚠️ *Suppression de tes données*\n\n" +
        `${ligneAcces}\n\n` +
        "Action irréversible : ton parrainage, tes préférences et ton historique seront effacés, et tu " +
        "seras retiré du canal privé VIP si tu en fais partie.\n\n" +
        "Ce qui est conservé (jamais utilisé à d'autre fin) :\n" +
        "• Ton adresse wallet — pour la prévention des abus (une offre par wallet)\n" +
        "• Ton historique de paiement — obligation légale/comptable\n" +
        "• Les actions admin te concernant, le cas échéant — traçabilité interne\n\n" +
        "Si ce que tu veux, c'est simplement qu'on arrête de t'écrire, deux options moins radicales " +
        "existent et gardent ton accès : /cancel stoppe toutes les relances, /prefs choisit précisément " +
        "ce que tu reçois.\n\n" +
        "Pour confirmer la suppression, envoie /delete\\_my\\_data confirm",
      { markdown: true }
    );
    return;
  }

  await eraseUserPersonalData(db, telegramId);

  // Le retrait du canal VIP est fait ICI et pas laissé au cron : quelqu'un qui
  // demande l'effacement de ses données ne doit pas attendre le prochain
  // passage pour cesser de recevoir des signaux.
  let retireDuVip = false;
  if (env.TELEGRAM_VIP_CHANNEL_ID) {
    retireDuVip = await removeChatMember(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_VIP_CHANNEL_ID, telegramId);
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "✅ Tes données personnelles ont été supprimées et ton accès a été révoqué.\n\n" +
      (retireDuVip
        ? "Tu as également été retiré du canal privé VIP.\n\n"
        : "Si tu es encore dans le canal privé VIP, quitte-le toi-même : je n'ai pas pu t'en retirer.\n\n") +
      "Certaines données transactionnelles peuvent être conservées pour des obligations légales ou " +
      "anti-fraude — le détail était dans l'écran précédent.\n\n" +
      "Si tu reviens un jour, /start repart de zéro. À noter : l'essai gratuit et le Pack Découverte " +
      "restent liés à ton wallet, ils ne se réinitialisent pas."
  );
}
