import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive } from "../../db/users";
import { buildStartMessage1Keyboard, buildStartMessage2Keyboard, buildStartMessage3Keyboard } from "../keyboards";
import { attributeReferralIfNeeded } from "../referral";
import { sleep } from "../../utils/sleep";

// Cumulés depuis l'appel de /start (pas l'un après l'autre) : +3s puis +10s
// au total, un rythme qui laisse le temps de lire chaque message sans faire
// attendre trop longtemps la suite. Le tout tourne dans le ctx.waitUntil()
// déjà posé par index.ts autour de routeUpdate() -- Telegram a déjà reçu son
// "ok" webhook, ces délais ne retardent donc rien côté Telegram.
const MESSAGE_2_DELAY_MS = 3_000;
const MESSAGE_3_DELAY_MS = 10_000;

/**
 * Refonte UX du 01/08/2026 : l'ancien /start envoyait un seul message dense
 * (pitch + liste de 5 commandes + lien de parrainage + lien du journal).
 * Remplacé par une séquence de 3 messages courts et espacés dans le temps
 * (accroche -> options concrètes -> aide), pensée pour être lue plutôt que
 * survolée. Le programme de parrainage et le journal public restent
 * accessibles via /referral et /help (déjà listés dedans), pas perdus --
 * juste plus déférés pour ne pas noyer le tout premier message.
 */
export async function handleStart(env: Env, telegramId: number, referralPayload?: string): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);
  await attributeReferralIfNeeded(env, telegramId, referralPayload);

  // plan 0 = essai déjà en cours (le proposer à nouveau ne changerait rien de
  // grave) ; plan 1/2/3 = abonnement payant actif, voir handleTrialCommand.
  const hasActivePaidPlan = isSubscriptionActive(user) && user.plan !== 0;
  const showTrial = !hasActivePaidPlan;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📊 Bot de signaux crypto — stratégie backtestée, sécurisation automatique des trades.\n\n" +
      "Notre priorité : ce que rapporte réellement un trade, pas un taux de réussite gonflé. " +
      "Un taux élevé ne sert à rien si les gagnants rapportent moins que ce que coûtent les perdants.",
    { keyboard: buildStartMessage1Keyboard(showTrial) }
  );

  await sleep(MESSAGE_2_DELAY_MS);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Pour voir comment ça marche :", {
    keyboard: buildStartMessage2Keyboard(showTrial),
  });

  await sleep(MESSAGE_3_DELAY_MS - MESSAGE_2_DELAY_MS);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "/help — toutes les commandes.", {
    keyboard: buildStartMessage3Keyboard(showTrial),
  });
}
