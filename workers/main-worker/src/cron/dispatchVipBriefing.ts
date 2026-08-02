import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, SupabaseConfig } from "../supabaseRest";
import { getOpenSignals, getSignalsResolvedSince } from "../db/signals";
import { computePnlPct } from "../signalMath";
import { isQuietHours } from "../utils/quietHours";

const JOB_NAME = "vip_briefing";
const BRIEFING_HOUR_UTC = 8;

/**
 * Briefing quotidien réservé au canal VIP (02/08/2026).
 *
 * Constat qui motive ce module : le canal VIP ne recevait QUE des messages
 * de célébration après un TP2/TP3 — c'est-à-dire presque rien, et seulement
 * les bonnes nouvelles. Quelqu'un qui paie 19 USDT rejoignait un canal
 * quasiment vide. C'était le principal trou de valeur du produit payant :
 * l'abonnement donnait l'avance sur les signaux, mais l'espace « VIP » lui-
 * même n'apportait rien de plus.
 *
 * Ce briefing donne chaque matin ce qu'un abonné ne peut pas reconstituer
 * seul : l'état exact du portefeuille suivi (positions ouvertes, lesquelles
 * sont déjà sécurisées, lesquelles restent à risque) et le bilan chiffré des
 * dernières 24 h, pertes comprises.
 *
 * Aucune prévision, aucune promesse : uniquement de l'information d'état.
 * C'est précisément ce qui manque à un abonné entre deux signaux, et c'est
 * défendable même si la stratégie traverse une mauvaise passe.
 */
async function recordSent(db: SupabaseConfig): Promise<void> {
  await upsertRow(db, "system_heartbeats", { job_name: JOB_NAME, last_run_at: new Date().toISOString(), alerted: false }, "job_name");
}

function formatLevel(value: number | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  return n >= 100 ? n.toFixed(2) : n.toPrecision(5);
}

export async function dispatchVipBriefing(env: Env): Promise<void> {
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;
  if (isQuietHours()) return;

  const now = new Date();
  if (now.getUTCHours() < BRIEFING_HOUR_UTC) return;

  const db = dbConfig(env);
  const heartbeat = await getHeartbeat(db, JOB_NAME);
  if (heartbeat) {
    const hours = (Date.now() - new Date(heartbeat.last_run_at).getTime()) / 3_600_000;
    if (hours < 20) return; // un seul briefing par jour
  }

  const dayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const [open, resolved] = await Promise.all([
    getOpenSignals(db),
    getSignalsResolvedSince(db, dayAgo),
  ]);

  // "Sécurisé" = TP1 atteint, stop remonté au prix d'entrée : la position ne
  // peut plus finir perdante. C'est l'information la plus utile du lot.
  const secured = open.filter((s) => s.tp1_hit_at != null);
  const atRisk = open.filter((s) => s.tp1_hit_at == null);

  const lines: string[] = [`🔑 *Briefing VIP — ${now.toISOString().slice(0, 10)}*`, ""];

  lines.push(`📂 *Positions ouvertes : ${open.length}*`);
  if (open.length === 0) {
    lines.push("_Aucune position en cours. La stratégie n'ouvre que lorsque ses critères sont réunis._");
  } else {
    lines.push(`🔒 ${secured.length} sécurisée(s) — ne peuvent plus finir perdantes`);
    lines.push(`⏳ ${atRisk.length} encore à risque`);
    lines.push("");
    for (const s of open.slice(0, 8)) {
      const tag = s.tp1_hit_at ? "🔒" : "⏳";
      const side = s.type === "BUY" ? "achat" : "vente";
      lines.push(`${tag} ${s.pair} ${side} — entrée ${formatLevel(s.entry_price)}, stop ${formatLevel(s.stop_loss)}`);
    }
    if (open.length > 8) lines.push(`… et ${open.length - 8} autre(s).`);
  }

  lines.push("");
  lines.push(`📊 *Dernières 24 h : ${resolved.length} clôture(s)*`);
  if (resolved.length > 0) {
    const wins = resolved.filter((s) => s.outcome === "WIN").length;
    const losses = resolved.filter((s) => s.outcome === "LOSS").length;
    const total = resolved.reduce((sum, s) => {
      if (s.outcome_price == null) return sum;
      return sum + computePnlPct(s.type, s.entry_price, s.outcome_price);
    }, 0);
    const sign = total >= 0 ? "+" : "";
    lines.push(`✅ ${wins} gagnante(s) — ❌ ${losses} perdante(s)`);
    lines.push(`Somme des variations : ${sign}${total.toFixed(2)}% _(hors pondération Multi-TP et frais)_`);
  } else {
    lines.push("_Aucune clôture sur la période._");
  }

  lines.push("");
  lines.push("_État du portefeuille suivi, pas une prévision. Le trading comporte un risque de perte en capital._");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_VIP_CHANNEL_ID), lines.join("\n"), { markdown: true });
  await recordSent(db);
}
