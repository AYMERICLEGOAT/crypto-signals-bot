import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, isSubscriptionActive } from "../../db/users";
import { buildStartMessage1Keyboard, buildStartMessage2Keyboard, buildStartMessage3Keyboard } from "../keyboards";
import { attributeReferralIfNeeded } from "../referral";
import { TREND_FILTER_STATUS } from "./subscribe";
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
 *
 * Réécriture des textes du 03/08/2026 (moteur Force Relative, voir
 * signals/config.py) : la mécanique ci-dessous est inchangée, seuls les
 * contenus bougent. Le filtre de tendance -- aucun signal tant que le Bitcoin
 * est sous sa moyenne mobile 200 jours, soit 41 % du temps sur 6 ans -- est
 * désormais annoncé dans le TOUT PREMIER message. Le reléguer plus bas (ou
 * pire, aux CGV) recréerait exactement le mécanisme du « 61,2 % de réussite »
 * affiché à tort pendant des mois : un abonné qui découvre après paiement que
 * le service peut ne rien émettre pendant des mois se sent trompé, à raison.
 * Annoncé d'emblée et expliqué, c'est au contraire l'argument différenciant.
 */
export async function handleStart(env: Env, telegramId: number, referralPayload?: string): Promise<void> {
  const user = await getOrCreateUser(dbConfig(env), telegramId);
  await attributeReferralIfNeeded(env, telegramId, referralPayload);

  // plan 0 = essai déjà en cours (le proposer à nouveau ne changerait rien de
  // grave) ; plan 1/2/3 = abonnement payant actif, voir handleTrialCommand.
  const hasActivePaidPlan = isSubscriptionActive(user) && user.plan !== 0;
  const showTrial = !hasActivePaidPlan;

  // Envoyé sans parse_mode (comme tout ce fichier depuis l'origine) : les
  // textes contiennent des %, des tirets, des parenthèses et des slashs de
  // commandes qui ont déjà fait tomber des messages Markdown sur ce projet.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "📊 Bot de signaux crypto — stratégie backtestée sur 6 ans de données.\n\n" +
      "Le plus important d'abord : quand le Bitcoin est sous sa moyenne mobile 200 jours, " +
      "ce bot n'émet AUCUN signal. Il attend. Sur 6 ans, cette attente a occupé 41 % du temps, " +
      "dont une fois 381 jours d'affilée.\n\n" +
      "C'est la règle centrale du système, pas un défaut : sans elle, la stratégie n'est " +
      "positive que 4 années sur 7 ; avec elle, aucune année perdante en 6 ans. En 2022 et " +
      "en 2026, elle n'a tout simplement rien émis, pendant que détenir les mêmes cryptos " +
      "coûtait -70,9 % puis -39,4 %.\n\n" +
      "Notre priorité : ce que rapporte réellement un trade, pas un taux de réussite gonflé. " +
      "On préfère ne rien t'envoyer plutôt que de te faire perdre de l'argent.",
    { keyboard: buildStartMessage1Keyboard(showTrial) }
  );

  // État du filtre repris de TREND_FILTER_STATUS (commands/subscribe.ts) plutôt
  // que réécrit ici : ce constat est daté à la main faute de source live, donc
  // le dupliquer garantirait qu'un des exemplaires devienne faux le jour de la
  // bascule. Les deux branches sont écrites pour que ce fichier reste juste
  // sans y retoucher quand `closed` repassera à false.
  const filterState = TREND_FILTER_STATUS.closed
    ? `⚠️ Et justement, en ce moment le filtre est FERMÉ : au ${TREND_FILTER_STATUS.measuredOn}, ` +
      `${TREND_FILTER_STATUS.detail}. Aucun signal ne partira tant qu'il ne l'aura pas repassée, ` +
      "et ça peut durer des semaines ou des mois. Autant que tu le saches avant de payer quoi que " +
      "ce soit — /faq explique combien de temps ces silences durent habituellement."
    : `Au ${TREND_FILTER_STATUS.measuredOn}, ce filtre est ouvert : des signaux partent. Il peut se ` +
      "refermer n'importe quand, sans préavis — /faq explique combien de temps ces silences durent " +
      "habituellement.";

  await sleep(MESSAGE_2_DELAY_MS);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, `${filterState}\n\nPour voir comment ça marche :`, {
    keyboard: buildStartMessage2Keyboard(showTrial),
  });

  await sleep(MESSAGE_3_DELAY_MS - MESSAGE_2_DELAY_MS);
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    // Formulé sans « ce silence » : le message doit rester juste quand le
    // filtre est ouvert et que des signaux partent.
    "/faq — pourquoi le bot se tait parfois, combien de temps ça dure, ce qui a changé.\n" +
      "/help — toutes les commandes.",
    { keyboard: buildStartMessage3Keyboard(showTrial) }
  );
}
