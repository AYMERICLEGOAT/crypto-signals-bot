import { Env } from "../env";
import { sendMessage } from "../telegram";

/**
 * Prévenir l'administrateur d'une situation qu'aucun automatisme ne peut
 * résoudre seul.
 *
 * POURQUOI CE MODULE EXISTE. Trois chemins de `pollPayments` se terminaient par
 * un `console.warn` et un `continue` : de l'argent arrivait sur l'adresse de
 * réception, le bot ne savait pas quoi en faire, et PERSONNE n'était prévenu —
 * ni le payeur, ni l'administrateur. La trace vivait dans un journal Cloudflare
 * que personne ne lit, et l'incident disparaissait avec elle.
 *
 * Ces situations ne sont pas des pannes : elles demandent une décision humaine
 * (activer manuellement, rembourser, demander le complément). Une décision
 * humaine suppose que quelqu'un soit au courant.
 *
 * JAMAIS BLOQUANT. Une alerte qui échoue ne doit pas empêcher le traitement des
 * paiements suivants : l'incident est journalisé et la boucle continue. Perdre
 * une alerte est regrettable ; perdre un paiement valide parce que l'alerte du
 * précédent a échoué serait absurde.
 */
export async function alerterAdmin(env: Env, texte: string): Promise<void> {
  if (!env.ADMIN_TELEGRAM_ID) {
    console.error("[alerte] ADMIN_TELEGRAM_ID absent — alerte perdue :", texte);
    return;
  }
  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.ADMIN_TELEGRAM_ID), texte).catch((err) =>
    console.error("[alerte] Envoi à l'administrateur impossible :", err)
  );
}
