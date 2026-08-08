import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { recordExitSurveyResponse, ExitSurveyReason } from "../../db/exitSurveys";

/**
 * Réponse à l'enquête de départ, posée après /cancel confirm.
 *
 * CE MODULE ÉTAIT ENTIÈREMENT MORT jusqu'au 08/08/2026. Le clavier existait
 * (bot/keyboards.ts::exitSurveyKeyboard), le routeur savait le traiter, la
 * table et la statistique étaient prêtes — mais le clavier n'était attaché à
 * aucun message. Personne n'a jamais pu y répondre, et /stats affichait
 * « aucune réponse » depuis toujours sans que ce soit un signal.
 *
 * CHAQUE MOTIF A DÉSORMAIS SA PROPRE RÉPONSE, et ce n'est pas de la politesse :
 * trois des quatre motifs correspondent à un malentendu que le produit peut
 * lever honnêtement, et le remerciement générique les laissait tous partir avec
 * leur idée fausse.
 *
 *   - « pas assez fréquents » : c'est le comportement voulu, mesuré, et il y a
 *     un chiffre à donner ;
 *   - « pas assez performants » : la majorité des signaux perdent, c'est écrit
 *     partout, et le résultat vient d'une minorité de gros gagnants ;
 *   - « trop cher » : il existe un palier à 15 USDT/mois que la personne n'a
 *     peut-être pas vu.
 *
 * Ce qu'on ne fait PAS : insister. Chaque réponse tient en trois lignes, ne
 * contient aucun bouton, et se termine. La personne vient de demander qu'on
 * cesse de lui écrire — lui répondre une fois est un dû, lui répondre deux fois
 * serait exactement ce qu'elle a refusé.
 */

const REPONSES: Record<ExitSurveyReason, string> = {
  frequency:
    "Noté, et c'est le retour le plus fréquent.\n\n" +
    "Ce silence est voulu : les moteurs directionnels sont coupés tant que le Bitcoin est sous sa moyenne " +
    "200 jours, soit 41 % du temps sur six ans. Sans cette règle, la stratégie n'est positive que 4 années " +
    "sur 7 ; avec elle, aucune année perdante sur 6.\n\n" +
    "Ça ne rend pas l'attente agréable pour autant, et c'est une raison légitime de partir.",

  performance:
    "Noté, merci de le dire franchement.\n\n" +
    "Un point qui aide parfois à relire ce qui s'est passé : la majorité des signaux directionnels PERDENT " +
    "— le signal médian perd 0,69 %. Tout le résultat vient d'une minorité de gros gagnants, ce qui suppose " +
    "de les prendre tous. Sur quelques semaines, il est parfaitement possible de n'avoir croisé que la " +
    "partie perdante.\n\n" +
    "Si ce n'est pas ce qui s'est passé chez toi, alors c'est un vrai retour, et il compte.",

  price:
    "Noté.\n\n" +
    "Au cas où ce serait passé inaperçu : le palier trimestriel revient à 15 USDT par mois au lieu de 19, " +
    "et le Pack Découverte est à 5 USDT pour 14 jours.\n\n" +
    "Si le prix reste le sujet, c'est une réponse claire et elle est utile.",

  other:
    "Noté, merci d'avoir pris le temps.\n\n" +
    "Si tu veux préciser, réponds simplement à ce message : l'administrateur le lira. Sinon, c'est très " +
    "bien aussi.",
};

/** data au format "exit_survey:frequency" | "exit_survey:performance" | "exit_survey:price" | "exit_survey:other". */
export async function handleExitSurveyResponse(env: Env, telegramId: number, data: string): Promise<void> {
  const reason = data.split(":")[1] as ExitSurveyReason;
  await recordExitSurveyResponse(dbConfig(env), telegramId, reason);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, REPONSES[reason] ?? REPONSES.other);
}
