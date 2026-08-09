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
import { trackCarryOutcomes } from "./cron/trackCarryOutcomes";
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
import { monthlyRecap } from "./cron/monthlyRecap";
import { rotateVipInviteLinkIfDue } from "./bot/vipChannel";
import { revokeExpiredVip } from "./cron/revokeExpiredVip";
import { sendTrialMidpointRecap } from "./cron/trialMidpointRecap";
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
      // Secret non configuré : on refuse TOUT, et on le dit dans les logs.
      //
      // Sans ce garde-fou, le webhook restait ouvert à la seule protection de
      // l'obscurité de son URL — n'importe qui la découvrant pouvait piloter le
      // bot. Le journaliser explicitement évite l'autre issue : chercher
      // pendant des heures pourquoi le bot ne répond plus alors qu'il refuse
      // simplement, et correctement, faute de secret.
      if (!env.TELEGRAM_WEBHOOK_SECRET) {
        console.error(
          "[webhook] TELEGRAM_WEBHOOK_SECRET absent : toutes les requêtes sont refusées. " +
            "Pose le secret (wrangler secret put TELEGRAM_WEBHOOK_SECRET) puis relance setWebhook."
        );
        return new Response("unauthorized", { status: 401 });
      }

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
      // LA CHAÎNE ÉTAIT TROP LONGUE POUR UNE SEULE INVOCATION.
      //
      // Dix-neuf tâches s'exécutaient à la suite dans le même appel, chacune
      // consommant plusieurs sous-requêtes (lectures Supabase, envois
      // Telegram). Un Worker Cloudflare est plafonné à 50 sous-requêtes par
      // invocation : la chaîne l'épuisait, et TOUT ce qui venait après mourait
      // sur « Too many subrequests by single Worker invocation ».
      //
      // Constaté en production le 09/08/2026 : les huit dernières tâches ne
      // s'exécutaient plus du tout — dont la séquence de bienvenue, les
      // relances de réabonnement, les enquêtes de satisfaction et l'épinglage
      // du canal. Des mécaniques de rétention et de revenu, mortes en silence,
      // sans qu'aucune alerte ne se déclenche puisque chaque .catch()
      // journalisait sans faire échouer le cron.
      //
      // Le cron des quinze minutes se déclenche à :00, :15, :30 et :45. On
      // répartit donc les tâches sur ces quatre créneaux : chaque invocation
      // n'en exécute qu'un quart, et le budget de sous-requêtes redevient très
      // large. Chaque tâche tourne une fois par heure au lieu de quatre.
      //
      // Ce rythme est sans conséquence : toutes ces tâches raisonnent en jours
      // ou en semaines (rappels d'expiration, récap hebdomadaire, retrait VIP à
      // échéance) et portent déjà un drapeau « déjà envoyé » en base. Aucune
      // n'est perdue, elles sont seulement différées d'au plus 45 minutes.
      //
      // Les tâches critiques pour le revenu occupent le premier créneau : si un
      // jour un groupe devait de nouveau saturer, ce ne serait pas celui-là.
      const creneau = Math.floor(new Date().getUTCMinutes() / 15) % 4;

      ctx.waitUntil(
        (async () => {
          // TROIS TÂCHES RETIRÉES DE LA CHAÎNE LE 08/08/2026, après avoir lu ce
          // qu'elles publiaient réellement. Les modules restent en place : la
          // décision doit rester traçable, pas effacée en silence.
          //
          //   dispatchCryptoFact — 51 anecdotes du type « le dernier bitcoin
          //     sera miné vers 2140 ». Vrai, sans rapport avec le produit, et
          //     sur un canal qui vend de la mesure, ça le banalise.
          //
          //   dispatchFearGreed — un indice repris d'un site tiers, accompagné
          //     de « pas un signal de trading ». Un message dont on doit
          //     préciser qu'il ne sert à rien n'a pas besoin d'être envoyé.
          //
          //   postLeaderboard — un podium de parrainage sur un canal qui compte
          //     deux personnes signale surtout qu'il n'y a personne.

          if (creneau === 0) {
            // ABONNEMENTS ET RÉTENTION — le groupe qu'on ne veut jamais perdre.
            await checkExpirationReminders(env).catch((err) => console.error("[cron] Erreur checkExpirationReminders:", err));
            await sendWelcomeFollowUps(env).catch((err) => console.error("[cron] Erreur sendWelcomeFollowUps:", err));
            await sendTrialMidpointRecap(env).catch((err) => console.error("[cron] Erreur sendTrialMidpointRecap:", err));
            await revokeExpiredVip(env).catch((err) => console.error("[cron] Erreur revokeExpiredVip:", err));
            return;
          }

          if (creneau === 1) {
            // RECONQUÊTE ET ENQUÊTES.
            await sendReengagementOffers(env).catch((err) => console.error("[cron] Erreur sendReengagementOffers:", err));
            await sendSatisfactionSurveys(env).catch((err) => console.error("[cron] Erreur sendSatisfactionSurveys:", err));
            await runLuckyVipDay(env).catch((err) => console.error("[cron] Erreur luckyVipDay:", err));
            await revertLuckyVip(env).catch((err) => console.error("[cron] Erreur revertLuckyVip:", err));
            return;
          }

          if (creneau === 2) {
            // CONTENU DES CANAUX. Chacune porte sa propre fenêtre horaire et
            // son drapeau « déjà publié » : passer une fois par heure suffit.
            await dispatchWeeklyRecap(env).catch((err) => console.error("[cron] Erreur dispatchWeeklyRecap:", err));
            await dispatchEducationalPost(env).catch((err) => console.error("[cron] Erreur dispatchEducationalPost:", err));
            await dispatchNoSignalStatus(env).catch((err) => console.error("[cron] Erreur dispatchNoSignalStatus:", err));
            await postChannelReminder(env).catch((err) => console.error("[cron] Erreur postChannelReminder:", err));
            await dispatchVipBriefing(env).catch((err) => console.error("[cron] Erreur dispatchVipBriefing:", err));
            return;
          }

          // MAINTENANCE ET PÉRIODIQUES. trackCarryOutcomes reste ici : la
          // clôture d'un carry est TEMPORELLE, une position tenue 21 jours n'a
          // aucun besoin d'être examinée quatre fois par heure.
          await trackCarryOutcomes(env).catch((err) => console.error("[cron] Erreur trackCarryOutcomes:", err));
          await runDailyMaintenance(env).catch((err) => console.error("[cron] Erreur runDailyMaintenance:", err));
          await ensureChannelPinned(env).catch((err) => console.error("[cron] Erreur ensureChannelPinned:", err));
          await dispatchSelectivityDigest(env).catch((err) => console.error("[cron] Erreur dispatchSelectivityDigest:", err));
          await monthlyRecap(env).catch((err) => console.error("[cron] Erreur monthlyRecap:", err));
          await rotateVipInviteLinkIfDue(env).catch((err) => console.error("[cron] Erreur rotateVipInviteLinkIfDue:", err));
        })()
      );
    }
  },
};
