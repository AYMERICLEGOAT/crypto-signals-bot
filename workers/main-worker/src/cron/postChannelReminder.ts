/**
 * Rappel unique dans le canal public : comment accéder au bot.
 *
 * Les visiteurs du canal doivent comprendre immédiatement où aller. Les
 * signaux et alertes portent déjà leur propre CTA, mais le canal peut rester
 * plusieurs heures sans rien publier (0 signal pendant des heures est un état
 * normal, voir checkSignalFreshness.ts) : ce rappel autonome garantit qu'un
 * visiteur arrivé pendant une période calme voit quand même l'information.
 *
 * FUSION du 02/08/2026 — deux rappels coexistaient et se doublonnaient dans
 * le canal : celui-ci (« 📡 Pour recevoir ces signaux en temps réel », toutes
 * les 6 h) et un dispatchChannelCta ajouté la veille (« 🔒 Pour recevoir… »,
 * toutes les 3 h via un déclencheur cron dédié). Un seul message subsiste,
 * ici, avec le contenu le plus complet des deux et la cadence de 3 h. Le
 * module et le déclencheur cron en double ont été supprimés.
 *
 * L'horloge reste system_heartbeats (job_name dédié) plutôt qu'un cron à
 * l'heure fixe : l'intervalle se rattrape tout seul si un cycle est sauté,
 * ce qui est fréquent sur les déclencheurs planifiés GitHub/Cloudflare.
 */

import { Env, dbConfig } from "../env";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, selectRows, SupabaseConfig } from "../supabaseRest";
import { getTrendFilterState } from "../market/trendFilter";
import { sendMessage } from "../telegram";
import { isQuietHours } from "../utils/quietHours";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";

const JOB_NAME = "channel_reminder";
// PORTÉ DE 3 À 8 HEURES le 08/08/2026, après avoir compté ce que le canal
// envoie réellement dans une journée. À 3 heures d'intervalle, ce seul module
// produisait jusqu'à HUIT messages par jour — plus que les signaux eux-mêmes.
// Un rappel n'apprend rien : il redit où s'abonner. Trois par jour au maximum
// suffisent largement à ce qu'un nouveau venu le voie, et huit garantissent
// surtout qu'il mette le canal en sourdine.
const REMINDER_INTERVAL_HOURS = 8;
// Un signal publié dans cette fenêtre rend le rappel superflu : il porte
// déjà son propre appel à l'action.
const QUIET_BEFORE_REMINDER_HOURS = 3;

/**
 * Cadence et texte de repli quand le filtre de tendance est fermé (03/08/2026).
 *
 * Le rappel normal dit « pour recevoir CES signaux en temps réel ». Pendant une
 * fermeture du filtre, il n'y a aucun signal : la phrase promet donc un flux
 * qui n'existe pas, et à 3 h d'intervalle elle le promet jusqu'à cinq fois par
 * jour. Sur la plus longue fermeture mesurée en 6 ans — 381 jours — cela
 * représente près de deux mille messages vantant des signaux non émis. C'est à
 * la fois le spam que ce module a justement été fusionné pour supprimer, et
 * une promesse que le produit ne tient pas.
 *
 * Pendant une fermeture, le rappel garde son utilité (un visiteur qui découvre
 * le canal doit savoir où aller) mais change de nature : il espace, et il
 * annonce la situation réelle au lieu de la masquer.
 */
const CLOSED_FILTER_INTERVAL_HOURS = 24;

/**
 * CE RAPPEL COMBLE UN SILENCE : il doit donc regarder TOUT le contenu, pas
 * seulement les signaux.
 *
 * Il n'interrogeait que la table `signals`. La liste du jour, les clôtures et
 * les posts pédagogiques lui étaient invisibles — et le canal public a donc
 * publié le 12/08/2026 :
 *
 *   10:27  LA LISTE DU JOUR — 🔴 CONDITION D'ENTRÉE : fermée
 *          Le Bitcoin est 9,0 % sous sa moyenne 200 jours.
 *   23:30  ⏸️ Le Bitcoin est sous sa moyenne 200 jours : la force relative ne
 *          prend plus de position.
 *
 * Le même fait, deux fois dans la même journée, sur le même canal, et la
 * seconde fois en moins précis. Le filtre est fermé depuis novembre 2025 : ce
 * doublon se répétait donc TOUS LES JOURS.
 *
 * `channel_posts` est le journal de tout ce qui part sur un canal — c'est la
 * bonne source pour savoir si le canal s'est tu.
 */
async function canalSilencieuxDepuis(db: SupabaseConfig, hours: number): Promise<boolean> {
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  try {
    const rows = await selectRows<{ reference: string | null }>(db, "channel_posts", {
      canal: "eq.public",
      sent_at: `gte.${since}`,
      select: "reference",
      limit: "5",
    });
    // Le rappel lui-même ne compte pas comme du contenu : sans cette
    // exclusion, un premier rappel empêcherait tous les suivants.
    return rows.filter((r) => r.reference !== "rappel-filtre-ferme" && r.reference !== "rappel").length === 0;
  } catch (err) {
    // En cas d'échec de lecture, on laisse passer le rappel : mieux vaut un
    // message de trop qu'un canal muet.
    console.error("[channel-reminder] Lecture du journal du canal impossible:", err);
    return true;
  }
}

async function recordReminderSent(db: SupabaseConfig): Promise<void> {
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}

export async function postChannelReminder(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID || !env.TELEGRAM_BOT_USERNAME) return;
  if (isQuietHours()) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  const hoursSinceLastReminder = heartbeat
    ? (Date.now() - new Date(heartbeat.last_run_at).getTime()) / (60 * 60 * 1000)
    : Infinity;
  // Filtre le gros des cycles avant toute requête réseau : ce module tourne
  // toutes les 15 min, la vérification du marché ne doit pas tourner autant.
  if (hoursSinceLastReminder < REMINDER_INTERVAL_HOURS) return;

  // Ce rappel COMBLE les silences, il ne s'ajoute pas au contenu. À 3 h
  // d'intervalle sur une plage de 16 h, il partirait jusqu'à 5 fois par jour
  // — un message identique répété cinq fois est exactement le spam qu'on
  // cherche à éliminer. S'il y a eu un vrai signal publié récemment, le
  // visiteur a déjà sous les yeux ce que fait le service ET son CTA : le
  // rappel n'apporterait rien.
  const silencieux = await canalSilencieuxDepuis(db, QUIET_BEFORE_REMINDER_HOURS);
  if (!silencieux) return;

  // État indéterminé (`null`) = on garde le comportement normal : c'est le
  // rappel historique, et le taire sur une simple panne réseau serait pire que
  // de le publier une fois de trop.
  const trend = await getTrendFilterState();

  // Le régulateur passe avant les deux branches (voir channelBudget.ts) : un
  // rappel est le message le moins urgent du canal, il ne doit jamais tomber
  // juste après autre chose.
  const verdict = await peutPublier(db, "public", "editorial");
  if (!verdict.autorise) return;

  if (trend?.isClosed) {
    if (hoursSinceLastReminder < CLOSED_FILTER_INTERVAL_HOURS) return;

    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      Number(env.TELEGRAM_CHANNEL_ID),
      // « la stratégie n'émet rien dans ce cas » était faux : le carry et le
      // momentum 4H travaillent précisément dans ce régime. Le dire évite la
      // contradiction avec les signaux qui partent le même jour.
      "⏸️ Le Bitcoin est sous sa moyenne 200 jours : la force relative ne prend plus de position.\n" +
        "Le carry de financement et le momentum 4H, eux, travaillent dans ce régime.\n" +
        `Pour comprendre la méthode et recevoir ce qui sort : @${env.TELEGRAM_BOT_USERNAME}`
    );
    await enregistrerEnvoi(db, "public", "editorial", "rappel-filtre-ferme");
    await recordReminderSent(db);
    return;
  }

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.TELEGRAM_CHANNEL_ID),
    `🔒 Pour recevoir ces signaux en temps réel, avec TP/SL et sécurisation automatique : @${env.TELEGRAM_BOT_USERNAME}\n` +
      "🎁 Essai gratuit de 3 jours avec /trial"
  );
  await enregistrerEnvoi(db, "public", "editorial", "rappel");
  await recordReminderSent(db);
}
