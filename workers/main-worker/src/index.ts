import { Env } from "./env";
import { TelegramUpdate } from "./telegram";
import { routeUpdate } from "./bot/router";
import { dispatchSignals } from "./cron/dispatchSignals";
import { dispatchPublicChannel } from "./cron/dispatchPublicChannel";
import { pollPayments } from "./cron/pollPayments";
import { pingSupabase } from "./supabaseRest";
import { dbConfig } from "./env";

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
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
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
        await dispatchPublicChannel(env).catch((err) => console.error("[cron] Erreur dispatchPublicChannel:", err));
        await pollPayments(env).catch((err) => console.error("[cron] Erreur pollPayments:", err));
      })()
    );
  },
};
