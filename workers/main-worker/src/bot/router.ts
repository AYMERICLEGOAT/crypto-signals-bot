import { Env, dbConfig } from "../env";
import { TelegramUpdate, answerCallbackQuery, sendMessage } from "../telegram";
import { isRateLimited } from "../db/rateLimit";
import { handleStart } from "./commands/start";
import { handleStatusCommand } from "./commands/status";
import { handleCarryCommand } from "./commands/carry";
import { handleMarcheCommand } from "./commands/marche";
import { handleTrialCommand } from "./commands/trial";
import { handleSubscribeCommand, handlePlanSelection, handlePurchaseConsent, handlePaymentMethodSelection } from "./commands/subscribe";
import { handlePayCommand } from "./commands/pay";
import { handleReferralCommand } from "./commands/referral";
import { handlePromoCodeCommand } from "./commands/promoCode";
import { handleStatsCommand } from "./commands/stats";
import { handleOpsNoteCommand } from "./commands/opsNote";
import { handleAdminActivateCommand } from "./commands/adminActivate";
import { handleDemoCommand } from "./commands/demo";
import { handleHistoryCommand } from "./commands/history";
import { handleSurveyResponse } from "./commands/surveyResponse";
import { handleCancelCommand, handleCancelExtension } from "./commands/cancel";
import { handleDeleteMyDataCommand } from "./commands/deleteMyData";
import { handleHelpCommand } from "./commands/help";
import { handleFaqCommand } from "./commands/faq";
import { handlePaymentGuideCommand } from "./commands/paymentGuide";
import { handleTrustCommand } from "./commands/trust";
import { handleExitSurveyResponse } from "./commands/exitSurveyResponse";
import { handlePrefsCommand, handlePrefsToggle } from "./commands/prefs";
import { handleMyPerformanceCommand } from "./commands/myPerformance";
import { handleGuideCommand } from "./commands/guide";
import { handleCheckPaymentCommand } from "./commands/checkPayment";
import { handleVipCommand } from "./commands/vip";
import { handleReviewCommand, handleReviewRating } from "./commands/review";
import { handleTextMessage } from "./walletAddressHandler";

/**
 * Anti-abus générique (Bloc 5.3) : l'administrateur en est exempté (ses
 * commandes, dont /admin_activate en cas d'urgence support, ne doivent
 * jamais être bloquées par erreur).
 */
async function isBlockedByRateLimit(env: Env, telegramId: number): Promise<boolean> {
  if (env.ADMIN_TELEGRAM_ID && String(telegramId) === env.ADMIN_TELEGRAM_ID) return false;
  return isRateLimited(dbConfig(env), telegramId);
}

/** Traite une Update Telegram reçue par le webhook (voir index.ts, fetch()). */
export async function routeUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  try {
  if (update.message) {
    const chatId = update.message.chat.id;
    if (await isBlockedByRateLimit(env, chatId)) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "⏳ Trop de commandes envoyées d'un coup. Réessaie dans une minute.");
      return;
    }
    const text = (update.message.text ?? "").trim();

    if (text === "/start" || text.startsWith("/start ")) {
      const payload = text.startsWith("/start ") ? text.slice("/start ".length).trim() : undefined;
      // Charge utile réservée : le bouton « Comment marche un carry » du canal
      // public pointe vers https://t.me/<bot>?start=carry. Sans ce cas, la
      // charge serait interprétée comme un code de parrainage, et le lecteur
      // arriverait sur l'accueil sans jamais voir ce qu'il venait lire.
      if (payload === "carry") {
        await handleCarryCommand(env, chatId);
      } else {
        await handleStart(env, chatId, payload || undefined);
      }
    } else if (text === "/subscribe") {
      await handleSubscribeCommand(env, chatId);
    } else if (text === "/status") {
      await handleStatusCommand(env, chatId);
    } else if (text === "/marche") {
      await handleMarcheCommand(env, chatId);
    } else if (text === "/carry") {
      await handleCarryCommand(env, chatId);
    } else if (text === "/trial") {
      await handleTrialCommand(env, chatId);
    } else if (text === "/pay") {
      await handlePayCommand(env, chatId);
    } else if (text === "/referral") {
      await handleReferralCommand(env, chatId);
    } else if (text === "/code" || text.startsWith("/code ")) {
      await handlePromoCodeCommand(env, chatId, text.slice("/code".length).trim());
    } else if (text === "/stats") {
      await handleStatsCommand(env, chatId);
    } else if (text === "/opsnote" || text.startsWith("/opsnote ")) {
      await handleOpsNoteCommand(env, chatId, text.slice("/opsnote".length).trim());
    } else if (text === "/admin_activate" || text.startsWith("/admin_activate ")) {
      await handleAdminActivateCommand(env, chatId, text.slice("/admin_activate".length).trim());
    } else if (text === "/demo") {
      await handleDemoCommand(env, chatId);
    } else if (text === "/history") {
      await handleHistoryCommand(env, chatId);
    } else if (text === "/cancel" || text.startsWith("/cancel ")) {
      await handleCancelCommand(env, chatId, text.slice("/cancel".length).trim());
    } else if (text === "/delete_my_data" || text.startsWith("/delete_my_data ")) {
      await handleDeleteMyDataCommand(env, chatId, text.slice("/delete_my_data".length).trim());
    } else if (text === "/help") {
      await handleHelpCommand(env, chatId);
    } else if (text === "/faq") {
      await handleFaqCommand(env, chatId);
    } else if (text === "/guide_paiement") {
      await handlePaymentGuideCommand(env, chatId);
    } else if (text === "/trust") {
      await handleTrustCommand(env, chatId);
    } else if (text === "/prefs") {
      await handlePrefsCommand(env, chatId);
    } else if (text === "/myperformance") {
      await handleMyPerformanceCommand(env, chatId);
    } else if (text === "/guide") {
      await handleGuideCommand(env, chatId);
    } else if (text === "/check_payment") {
      await handleCheckPaymentCommand(env, chatId);
    } else if (text === "/vip") {
      await handleVipCommand(env, chatId);
    } else if (text === "/review") {
      await handleReviewCommand(env, chatId);
    } else if (text && !text.startsWith("/")) {
      await handleTextMessage(env, chatId, text);
    } else if (text.startsWith("/")) {
      // UNE COMMANDE INCONNUE NE DOIT JAMAIS ÊTRE ACCUEILLIE PAR LE SILENCE.
      //
      // Une faute de frappe ne déclenchait aucune réponse, et rien ne distingue
      // alors une erreur de saisie d'un bot en panne. Quelqu'un qui tape
      // /suscribe au lieu de /subscribe repart en pensant que le service ne
      // fonctionne pas — au moment précis où il essayait de payer.
      //
      // Les trois commandes proposées sont celles qui servent le plus souvent,
      // et les seules qui ne demandent rien.
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        `Je ne connais pas la commande ${text.split(/\s+/)[0]}.\n\n` +
          "Les plus utiles :\n" +
          "/help — toutes les commandes\n" +
          "/marche — l'état du marché en direct\n" +
          "/demo — un vrai signal, en entier"
      );
    }
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat.id ?? cq.from.id;
    const data = cq.data ?? "";

    // Simple accusé de réception (fait disparaître le sablier sur le bouton).
    // NE DOIT JAMAIS bloquer l'action demandée : Telegram refuse cet appel
    // avec un 400 "query is too old" dès que la callback query a expiré —
    // ce qui arrive réellement quand l'utilisateur clique sur un bouton d'un
    // message ancien, ou quand le Worker démarre à froid et met quelques
    // secondes à répondre. Avant ce correctif, l'exception remontait et
    // faisait abandonner TOUTE la suite : l'utilisateur cliquait
    // « S'abonner » et il ne se passait rien (bug découvert le 01/08/2026 en
    // rejouant les callbacks sur le webhook déployé).
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, cq.id).catch((err) =>
      console.error("[bot] answerCallbackQuery non bloquant:", err)
    );

    // Rate-limite/exempte la PERSONNE qui clique (cq.from.id), pas le chat où
    // le bouton est affiché -- pour un bouton posté dans un canal, chatId
    // serait l'ID (négatif) du canal, jamais égal à ADMIN_TELEGRAM_ID : l'admin
    // se ferait rate-limiter par erreur en cliquant sur son propre canal
    // (audit du 31/07 ; sur-limitation seulement, jamais de sous-limitation).
    if (await isBlockedByRateLimit(env, cq.from.id)) return; // callback déjà "répondu" ci-dessus, on ignore juste l'action

    if (data === "start:subscribe") await handleSubscribeCommand(env, chatId);
    else if (data === "start:trial") await handleTrialCommand(env, chatId);
    else if (data === "start:status") await handleStatusCommand(env, chatId);
    else if (data === "start:demo") await handleDemoCommand(env, chatId);
    else if (data === "start:help") await handleHelpCommand(env, chatId);
    else if (data === "start:referral") await handleReferralCommand(env, chatId);
    // Proposé juste après une confirmation de paiement : c'est le seul moment
    // où rejoindre le canal VIP est l'action évidente à faire ensuite.
    else if (data === "start:vip") await handleVipCommand(env, chatId);
    else if (data === "cancel:extend") await handleCancelExtension(env, chatId);
    else if (data.startsWith("plan:")) await handlePlanSelection(env, chatId, data);
    else if (data.startsWith("consent:")) await handlePurchaseConsent(env, chatId, data);
    // Avant le préfixe générique "pay:" : "pay:guide" n'est pas un choix de
    // moyen de paiement et serait sinon capté par le handler suivant.
    else if (data === "pay:guide") await handlePaymentGuideCommand(env, chatId);
    else if (data.startsWith("pay:")) await handlePaymentMethodSelection(env, chatId, data);
    else if (data.startsWith("survey:")) await handleSurveyResponse(env, chatId, data);
    else if (data.startsWith("exit_survey:")) await handleExitSurveyResponse(env, chatId, data);
    else if (data.startsWith("prefs:")) await handlePrefsToggle(env, chatId, data);
    else if (data.startsWith("review:")) await handleReviewRating(env, chatId, data);
  }
  } catch (err) {
    // Telegram reçoit déjà un 200 pour éviter les doublons : sans réponse de
    // secours, toute panne transitoire du handler paraît être un silence.
    console.error("[bot] Command failed:", err);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? update.callback_query?.from.id;
    if (chatId !== undefined) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "Une erreur temporaire est survenue. Réessaie dans quelques instants.").catch((sendErr) =>
        console.error("[bot] Fallback notification failed:", sendErr)
      );
    }
  }
}
