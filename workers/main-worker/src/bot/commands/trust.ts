import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getActivePayingCount } from "../../db/adminStats";

/** Bloc 13.1 : preuve sociale publique — nombre réel d'abonnés payants actifs, calculé en direct (jamais un chiffre inventé). */
export async function handleTrustCommand(env: Env, telegramId: number): Promise<void> {
  // L'administrateur est exclu : il s'active un plan pour tester le parcours
  // de paiement, et se compter soi-même dans une preuve sociale publique
  // fausserait le seul chiffre que cette commande promet d'être honnête.
  const count = await getActivePayingCount(dbConfig(env), env.ADMIN_TELEGRAM_ID);

  const text =
    count > 0
      ? `📊 *${count} trader${count > 1 ? "s" : ""} nous fait confiance*\n\nAbonné(s) payant(s) actif(s) en ce moment, chiffre calculé en direct depuis notre base — pas un chiffre marketing figé.`
      : "📊 *Encore aucun abonné payant actif*\n\nOn est honnêtes : ce service vient de démarrer. Sois parmi les tout premiers à l'essayer avec /trial.";

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, text, { markdown: true });
}
