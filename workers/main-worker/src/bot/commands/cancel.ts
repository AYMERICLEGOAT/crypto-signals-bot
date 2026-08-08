import { Env, dbConfig } from "../../env";
import { sendMessage, InlineKeyboard } from "../../telegram";
import { getOrCreateUser, markUserCancelled, isSubscriptionActive, activateSubscription } from "../../db/users";
import { updateRows } from "../../supabaseRest";
import { addDays } from "../../utils/date";

/**
 * /cancel — arrêter les relances commerciales.
 *
 * CE QUE CETTE COMMANDE ANNULE, ET CE QU'ELLE N'ANNULE PAS. Il n'y a aucun
 * prélèvement automatique dans ce produit : un abonnement s'arrête tout seul à
 * échéance. /cancel ne résilie donc rien — il dit « cessez de me solliciter ».
 *
 * UNE SEULE OFFRE, AU SEUL MOMENT OÙ ELLE EST HONNÊTE.
 *
 * L'ancienne version de ce module posait en principe que « l'annulation est une
 * limite de contact, pas une occasion de rétention », et ce principe est juste :
 * profiter du moment où quelqu'un demande le silence pour lui vendre quelque
 * chose est précisément le procédé que /cancel existe pour arrêter.
 *
 * Le compromis retenu tient en trois règles :
 *
 *   1. L'offre apparaît UNE FOIS, sur l'écran de confirmation que la personne
 *      voit de toute façon. Aucun message supplémentaire n'est envoyé pour
 *      l'occasion : rien n'est ajouté à ce qu'elle recevait déjà.
 *   2. Elle n'est proposée qu'à quelqu'un qui a un accès ACTIF. Offrir des
 *      jours à qui n'a rien serait une publicité déguisée en cadeau.
 *   3. Après `/cancel confirm`, plus rien. Jamais. Et l'offre ne se représente
 *      pas une seconde fois (retention_offer_used) : réoffrir à quelqu'un qui a
 *      déjà dit non est exactement le harcèlement qu'on prétend éviter.
 *
 * Sept jours, et non un mois : c'est assez pour traverser un creux de marché et
 * revoir des signaux, trop peu pour que quelqu'un demande le silence dans le
 * seul but de récupérer un mois gratuit.
 */

const JOURS_OFFERTS = 7;

export async function handleCancelCommand(env: Env, telegramId: number, rawArgs: string): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);
  const confirmed = rawArgs.trim().toLowerCase() === "confirm";

  if (user.cancelled) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "C'est déjà fait : aucune relance ni offre ne te sera envoyée. /subscribe reste disponible si tu changes d'avis."
    );
    return;
  }

  if (!confirmed) {
    const actif = isSubscriptionActive(user);
    const statusLine = actif
      ? `Ton accès reste valable jusqu'au ${new Date(user.expiration as string).toLocaleDateString("fr-FR")}.`
      : "Tu n'as pas d'abonnement actif en ce moment.";

    // L'offre n'existe que pour un accès actif, et une seule fois dans la vie
    // du compte. Voir l'en-tête pour le raisonnement.
    const offreDisponible = actif && !user.retention_offer_used;
    const keyboard: InlineKeyboard | undefined = offreDisponible
      ? [[{ text: `🎁 Prolonger de ${JOURS_OFFERTS} jours, gratuitement`, callback_data: "cancel:extend" }]]
      : undefined;

    const offreTexte = offreDisponible
      ? `\n\nAvant de partir, une chose et une seule : si tu t'arrêtes parce que le marché a été calme, ` +
        `${JOURS_OFFERTS} jours te sont offerts pour voir la suite. Le filtre de tendance est fermé 41 % du ` +
        "temps — il arrive qu'un abonnement entier tombe dans un creux, et ce n'est pas représentatif.\n" +
        "Aucune contrepartie, aucune relance supplémentaire. Si tu déclines, on n'en reparle plus."
      : "";

    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "⚠️ *Arrêter les relances*\n\n" +
        `${statusLine}\n` +
        "Après confirmation, aucun rappel ou offre ne sera envoyé. Tu pourras revenir de toi-même avec /subscribe." +
        `${offreTexte}\n\n` +
        "Pour confirmer, envoie /cancel confirm",
      { markdown: true, keyboard }
    );
    return;
  }

  await markUserCancelled(db, telegramId);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "✅ C'est noté : plus aucune relance ni offre ne te sera envoyée. Ton accès déjà payé reste valable jusqu'à son expiration."
  );
}

/**
 * Bouton « prolonger » de l'écran de confirmation.
 *
 * Le drapeau est posé AVANT la prolongation : si l'activation échoue, la
 * personne ne peut pas rejouer l'offre en boucle. Le sens de dégradation est
 * délibéré — mieux vaut perdre une prolongation qu'ouvrir une faille.
 */
export async function handleCancelExtension(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);

  if (user.retention_offer_used || !isSubscriptionActive(user)) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Cette offre a déjà été utilisée. /subscribe reste disponible quand tu veux."
    );
    return;
  }

  await updateRows(db, "users", { telegram_id: `eq.${telegramId}` }, { retention_offer_used: true });

  const nouvelleFin = addDays(new Date(user.expiration as string), JOURS_OFFERTS);
  await activateSubscription(db, telegramId, user.plan ?? 1, nouvelleFin);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `🎁 C'est fait : ton accès court maintenant jusqu'au ${nouvelleFin.toLocaleDateString("fr-FR")}.\n\n` +
      "Rien d'autre à faire, et aucune relance supplémentaire ne partira. Si tu veux quand même couper les " +
      "messages commerciaux, /cancel confirm reste valable — la prolongation, elle, t'est acquise."
  );
}
