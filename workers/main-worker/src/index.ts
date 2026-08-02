import { Env } from "./env";
import { TelegramUpdate } from "./telegram";
import { routeUpdate } from "./bot/router";
import { dispatchSignals } from "./cron/dispatchSignals";
import { dispatchStandardTier } from "./cron/dispatchStandardTier";
import { dispatchPublicChannel } from "./cron/dispatchPublicChannel";
import { dispatchMomentumAlerts } from "./cron/dispatchMomentumAlerts";
import { dispatchVolatilitySuspensions } from "./cron/dispatchVolatilitySuspensions";
import { dispatchCryptoFact } from "./cron/dispatchCryptoFact";
import { dispatchFearGreed } from "./cron/dispatchFearGreed";
import { dispatchWeeklyRecap } from "./cron/dispatchWeeklyRecap";
import { trackSignalOutcomes } from "./cron/trackSignalOutcomes";
import { announceSignalPause } from "./cron/announceSignalPause";
import { dispatchEducationalPost } from "./cron/dispatchEducationalPost";
import { dispatchNoSignalStatus } from "./cron/dispatchNoSignalStatus";
import { runLuckyVipDay } from "./cron/luckyVipDay";
import { revertLuckyVip } from "./cron/revertLuckyVip";
import { postLeaderboard } from "./cron/postLeaderboard";
import { checkExpirationReminders } from "./cron/expirationReminders";
import { sendReengagementOffers } from "./cron/reengagementOffer";
import { sendSatisfactionSurveys } from "./cron/satisfactionSurvey";
import { sendWelcomeFollowUps } from "./cron/welcomeSequence";
import { pollPayments } from "./cron/pollPayments";
import { runDailyMaintenance } from "./cron/dailyMaintenance";
import { monitorSignalsHeartbeat } from "./cron/monitorSignalsHeartbeat";
import { checkSignalFreshness } from "./cron/checkSignalFreshness";
import { ensureChannelPinned } from "./cron/ensureChannelPinned";
import { postChannelReminder } from "./cron/postChannelReminder";
import { dispatchVipBriefing } from "./cron/dispatchVipBriefing";
import { dispatchSelectivityDigest } from "./cron/dispatchSelectivityDigest";
import { rotateVipInviteLinkIfDue } from "./bot/vipChannel";
import { pingSupabase } from "./supabaseRest";
import { dbConfig } from "./env";
import { timingSafeEqual } from "./utils/timingSafeEqual";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      try {
        const dbOk = await pingSupabase(dbConfig(env));
        return new Response(dbOk ? "ok" : "db-unreachable", { status: dbOk ? 200 : 503 });
      } catch {
        return new Response("db-unreachable", { status: 503 });
      }
    }

    if (url.pathname === "/telegram-webhook" && request.method === "POST") {
      // Empêche quiconque découvre l'URL de déclencher n'importe quelle
      // commande du bot : seul Telegram, qui renvoie ce secret configuré via
      // setWebhook, passe ce contrôle.
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (!secret || !timingSafeEqual(secret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return new Response("unauthorized", { status: 401 });
      }

      let update: TelegramUpdate;
      try {
        update = await request.json();
      } catch {
        return new Response("bad request", { status: 400 });
      }

      // waitUntil : on répond tout de suite à Telegram (qui retente sinon en
      // cas de lenteur) pendant que le traitement continue en arrière-plan.
      ctx.waitUntil(routeUpdate(env, update).catch((err) => console.error("[webhook] Erreur de traitement:", err)));
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // Deux déclencheurs cron distincts (audit du 31/07, voir wrangler.toml) :
    // les ~27 tâches tournant toutes les 5 min dans UNE seule invocation
    // dépassaient la limite de sous-requêtes Cloudflare par invocation --
    // les dernières tâches de la chaîne échouaient silencieusement à chaque
    // cycle. Scindé par fréquence réelle de besoin : signaux/paiements/suivi
    // restent sur */5 (réactivité), contenu quotidien/hebdo et tâches
    // d'administration passent sur */15 (déjà protégées par leurs propres
    // gates "déjà envoyé aujourd'hui/cette semaine", un délai de quelques
    // minutes ne change rien pour l'utilisateur).
    if (event.cron === "*/5 * * * *") {
      ctx.waitUntil(
        (async () => {
          await dispatchSignals(env).catch((err) => console.error("[cron] Erreur dispatchSignals:", err));
          await dispatchStandardTier(env).catch((err) => console.error("[cron] Erreur dispatchStandardTier:", err));
          await dispatchPublicChannel(env).catch((err) => console.error("[cron] Erreur dispatchPublicChannel:", err));
          await dispatchMomentumAlerts(env).catch((err) => console.error("[cron] Erreur dispatchMomentumAlerts:", err));
          await dispatchVolatilitySuspensions(env).catch((err) => console.error("[cron] Erreur dispatchVolatilitySuspensions:", err));
          await trackSignalOutcomes(env).catch((err) => console.error("[cron] Erreur trackSignalOutcomes:", err));
          await announceSignalPause(env).catch((err) => console.error("[cron] Erreur announceSignalPause:", err));
          await pollPayments(env).catch((err) => console.error("[cron] Erreur pollPayments:", err));
          await monitorSignalsHeartbeat(env).catch((err) => console.error("[cron] Erreur monitorSignalsHeartbeat:", err));
          await checkSignalFreshness(env).catch((err) => console.error("[cron] Erreur checkSignalFreshness:", err));
        })()
      );
      return;
    }

    if (event.cron === "*/15 * * * *") {
      ctx.waitUntil(
        (async () => {
          await dispatchCryptoFact(env).catch((err) => console.error("[cron] Erreur dispatchCryptoFact:", err));
          await dispatchFearGreed(env).catch((err) => console.error("[cron] Erreur dispatchFearGreed:", err));
          await dispatchWeeklyRecap(env).catch((err) => console.error("[cron] Erreur dispatchWeeklyRecap:", err));
          await dispatchEducationalPost(env).catch((err) => console.error("[cron] Erreur dispatchEducationalPost:", err));
          await dispatchNoSignalStatus(env).catch((err) => console.error("[cron] Erreur dispatchNoSignalStatus:", err));
          await runLuckyVipDay(env).catch((err) => console.error("[cron] Erreur luckyVipDay:", err));
          await revertLuckyVip(env).catch((err) => console.error("[cron] Erreur revertLuckyVip:", err));
          await postLeaderboard(env).catch((err) => console.error("[cron] Erreur postLeaderboard:", err));
          await checkExpirationReminders(env).catch((err) => console.error("[cron] Erreur checkExpirationReminders:", err));
          await sendReengagementOffers(env).catch((err) => console.error("[cron] Erreur sendReengagementOffers:", err));
          await sendSatisfactionSurveys(env).catch((err) => console.error("[cron] Erreur sendSatisfactionSurveys:", err));
          await sendWelcomeFollowUps(env).catch((err) => console.error("[cron] Erreur sendWelcomeFollowUps:", err));
          await runDailyMaintenance(env).catch((err) => console.error("[cron] Erreur runDailyMaintenance:", err));
          await ensureChannelPinned(env).catch((err) => console.error("[cron] Erreur ensureChannelPinned:", err));
          await postChannelReminder(env).catch((err) => console.error("[cron] Erreur postChannelReminder:", err));
          await dispatchVipBriefing(env).catch((err) => console.error("[cron] Erreur dispatchVipBriefing:", err));
          await dispatchSelectivityDigest(env).catch((err) => console.error("[cron] Erreur dispatchSelectivityDigest:", err));
          await rotateVipInviteLinkIfDue(env).catch((err) => console.error("[cron] Erreur rotateVipInviteLinkIfDue:", err));
        })()
      );
    }
  },
};
