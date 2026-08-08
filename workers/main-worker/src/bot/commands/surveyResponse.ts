import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { setSurveyResponse } from "../../db/users";
import { buildReferralLink, REFERRAL_BONUS_DAYS } from "../referral";

/**
 * Réponse au sondage de satisfaction envoyé au septième jour d'abonnement.
 *
 * CE QUI MANQUAIT : les deux réponses se terminaient par un remerciement sec.
 * Un abonné satisfait — le meilleur public qui existe pour ce produit, et le
 * seul moment où il le dit explicitement — repartait sans qu'on lui propose
 * quoi que ce soit. Un mécontent, lui, n'avait nulle part où dire ce qui
 * n'allait pas, et son insatisfaction restait un chiffre dans une table.
 *
 * Chaque branche a maintenant une suite, et une seule :
 *
 *   👍 son lien de parrainage. C'est l'instant exact où recommander est
 *      naturel — quelqu'un vient de dire que le produit lui convient. Proposé
 *      à froid, le parrainage se lit comme une sollicitation ; proposé ici,
 *      comme une évidence.
 *   👎 une invitation à expliquer, en répondant simplement au message. Rien à
 *      cliquer, rien à remplir. Un mécontent qu'on ne laisse pas parler part,
 *      et on n'apprend rien.
 *
 * Aucun bouton, aucun envoi supplémentaire : la suite tient dans le message de
 * remerciement lui-même.
 */
export async function handleSurveyResponse(env: Env, telegramId: number, data: string): Promise<void> {
  const response = data.split(":")[1] as "up" | "down";
  const db = dbConfig(env);
  await setSurveyResponse(db, telegramId, response);

  const texte =
    response === "up"
      ? "Merci ! 🙌\n\n" +
        "Si tu connais quelqu'un que ça pourrait intéresser, voici ton lien :\n" +
        `${buildReferralLink(env, telegramId)}\n\n` +
        `Chaque personne qui s'abonne via ce lien t'offre ${REFERRAL_BONUS_DAYS} jours d'accès, et lui ` +
        "donne une remise. Ton suivi est dans /referral.\n\n" +
        "Et si tu as deux minutes, /review permet de laisser un avis — c'est ce qui aide le plus quelqu'un " +
        "qui hésite."
      : "Merci de l'avoir dit. 🙏\n\n" +
        "Ce qui aiderait vraiment : réponds simplement à ce message en expliquant ce qui ne va pas. " +
        "L'administrateur le lit, il n'y a rien à remplir et personne d'autre ne le verra.\n\n" +
        "Deux choses qui reviennent souvent, au cas où : le silence en marché baissier est voulu (les " +
        "moteurs directionnels sont coupés 41 % du temps), et la majorité des signaux perdent — tout le " +
        "résultat vient d'une minorité de gros gagnants. /faq détaille les deux.";

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, texte);
}
