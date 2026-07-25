import { Env } from "./env";
import { TelegramUpdate } from "./telegram";
import { routeUpdate } from "./bot/router";
import { dispatchSignals } from "./cron/dispatchSignals";
import { dispatchStandardTier } from "./cron/dispatchStandardTier";
import { dispatchPublicChannel } from "./cron/dispatchPublicChannel";
import { dispatchMomentumAlerts } from "./cron/dispatchMomentumAlerts";
import { trackSignalOutcomes } from "./cron/trackSignalOutcomes";
import { announceSignalPause } from "./cron/announceSignalPause";
import { dispatchEducationalPost } from "./cron/dispatchEducationalPost";
import { runLuckyVipDay } from "./cron/luckyVipDay";
import { postLeaderboard } from "./cron/postLeaderboard";
import { checkExpirationReminders } from "./cron/expirationReminders";
import { sendReengagementOffers } from "./cron/reengagementOffer";
import { sendSatisfactionSurveys } from "./cron/satisfactionSurvey";
import { pollPayments } from "./cron/pollPayments";
import { runDailyMaintenance } from "./cron/dailyMaintenance";
import { monitorSignalsHeartbeat } from "./cron/monitorSignalsHeartbeat";
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
      // Empêche quiconque découvre l'URL de déclencher des commandes (dont
      // /trial, qui dépense du gas depuis le wallet admin) : seul Telegram,
      // qui renvoie ce secret configuré via setWebhook, passe ce contrôle.
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

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        await dispatchSignals(env).catch((err) => console.error("[cron] Erreur dispatchSignals:", err));
        await dispatchStandardTier(env).catch((err) => console.error("[cron] Erreur dispatchStandardTier:", err));
        await dispatchPublicChannel(env).catch((err) => console.error("[cron] Erreur dispatchPublicChannel:", err));
        await dispatchMomentumAlerts(env).catch((err) => console.error("[cron] Erreur dispatchMomentumAlerts:", err));
        await trackSignalOutcomes(env).catch((err) => console.error("[cron] Erreur trackSignalOutcomes:", err));
        await announceSignalPause(env).catch((err) => console.error("[cron] Erreur announceSignalPause:", err));
        await dispatchEducationalPost(env).catch((err) => console.error("[cron] Erreur dispatchEducationalPost:", err));
        await runLuckyVipDay(env).catch((err) => console.error("[cron] Erreur luckyVipDay:", err));
        await postLeaderboard(env).catch((err) => console.error("[cron] Erreur postLeaderboard:", err));
        await checkExpirationReminders(env).catch((err) => console.error("[cron] Erreur checkExpirationReminders:", err));
        await sendReengagementOffers(env).catch((err) => console.error("[cron] Erreur sendReengagementOffers:", err));
        await sendSatisfactionSurveys(env).catch((err) => console.error("[cron] Erreur sendSatisfactionSurveys:", err));
        await pollPayments(env).catch((err) => console.error("[cron] Erreur pollPayments:", err));
        await runDailyMaintenance(env).catch((err) => console.error("[cron] Erreur runDailyMaintenance:", err));
        await monitorSignalsHeartbeat(env).catch((err) => console.error("[cron] Erreur monitorSignalsHeartbeat:", err));
      })()
    );
  },
};
