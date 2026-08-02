import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, SupabaseConfig } from "../supabaseRest";
import { getActiveUsers, UserRecord } from "../db/users";
import { getUserSignalHistory, SignalDeliveryWithSignal } from "../db/history";
import { getLoyaltyBadge } from "../bot/loyaltyBadge";
import { computePnlPct } from "../signalMath";

const JOB_NAME = "monthly_recap";
const RECAP_HOUR_UTC = 10;

/**
 * Bilan mensuel personnalisé, envoyé en privé à chaque abonné actif.
 *
 * Motif (02/08/2026) : le service envoie beaucoup de messages « produit »
 * (signaux, alertes, relances) mais aucun qui dise à l'abonné où IL en est.
 * Or c'est exactement ce qui décide d'un renouvellement : au moment de payer
 * à nouveau, quelqu'un qui ne se souvient pas de ce qu'il a reçu ne
 * renouvelle pas. Un bilan chiffré personnel — pas générique — répond à la
 * seule question qui compte pour lui : « qu'est-ce que ça m'a apporté ? ».
 *
 * Contenu volontairement factuel, pertes comprises. Un bilan qui ne
 * montrerait que les trades gagnants serait de la communication déguisée en
 * relevé, exactement ce que ce projet reproche aux autres services. Un mois
 * défavorable est affiché tel quel, avec le rappel que la taille de position
 * compte davantage que le nombre de signaux reçus.
 *
 * Une fois par mois, jamais en pleine nuit, et jamais aux comptes ayant fait
 * /cancel (respect de la même règle que les autres messages non essentiels).
 */
async function recordSent(db: SupabaseConfig): Promise<void> {
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}

function buildRecap(user: UserRecord, deliveries: SignalDeliveryWithSignal[]): string {
  const signals = deliveries.map((d) => d.signals).filter((x): x is NonNullable<typeof x> => x != null);
  const closed = signals.filter((s) => s.outcome && s.outcome_price != null);
  const secured = signals.filter((s) => s.tp1_hit_at != null).length;
  const wins = closed.filter((s) => s.outcome === "WIN").length;
  const losses = closed.filter((s) => s.outcome === "LOSS").length;

  const totalPct = closed.reduce(
    (sum, s) => sum + computePnlPct(s.type, s.entry_price, s.outcome_price as number),
    0
  );
  const sign = totalPct >= 0 ? "+" : "";
  const badge = getLoyaltyBadge(user);

  const lines = [
    "📈 *Ton bilan du mois*",
    "",
    `📨 ${signals.length} signal(aux) reçu(s)`,
    `🔒 ${secured} sécurisé(s) — TP1 atteint, stop remonté à l'entrée`,
  ];

  if (closed.length > 0) {
    lines.push(
      `✅ ${wins} gagnant(s) — ❌ ${losses} perdant(s) sur ${closed.length} clôturé(s)`,
      `📊 Somme des variations : ${sign}${totalPct.toFixed(2)}%`
    );
  } else {
    lines.push("_Aucun de tes signaux n'est encore clôturé : le bilan chiffré viendra le mois prochain._");
  }

  if (badge) lines.push("", badge);

  lines.push(
    "",
    "_Somme brute des variations, hors pondération Multi-TP, taille de position et frais. " +
      "Ce que tu as réellement gagné ou perdu dépend d'abord de la taille que TU as engagée sur " +
      "chaque trade._",
    "",
    "Détail complet : /myperformance — historique : /history"
  );
  return lines.join("\n");
}

export async function monthlyRecap(env: Env): Promise<void> {
  const now = new Date();
  // Le 1er de chaque mois, à partir de 10h UTC.
  if (now.getUTCDate() !== 1 || now.getUTCHours() < RECAP_HOUR_UTC) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (heartbeat) {
    const days = (Date.now() - new Date(heartbeat.last_run_at).getTime()) / 86_400_000;
    if (days < 20) return; // déjà envoyé ce mois-ci
  }

  let subscribers: UserRecord[];
  try {
    subscribers = await getActiveUsers(db);
  } catch (err) {
    console.error("[monthly-recap] Lecture des abonnés impossible:", err);
    return;
  }

  // Les comptes ayant fait /cancel ne reçoivent plus de message non essentiel.
  const recipients = subscribers.filter((u) => !u.cancelled);
  if (recipients.length === 0) {
    await recordSent(db);
    return;
  }

  // getUserSignalHistory prend un NOMBRE de lignes, pas une date : on en
  // demande large puis on filtre le dernier mois sur delivered_at.
  const cutoff = Date.now() - 31 * 86_400_000;
  for (const user of recipients) {
    try {
      const all = await getUserSignalHistory(db, user.telegram_id, 100);
      const recent = all.filter((d) => new Date(d.delivered_at).getTime() >= cutoff);
      if (recent.length === 0) continue; // rien à raconter, on ne dérange pas
      await sendMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_id, buildRecap(user, recent), { markdown: true });
    } catch (err) {
      console.error(`[monthly-recap] Échec pour ${user.telegram_id}:`, err);
    }
  }

  await recordSent(db);
}
