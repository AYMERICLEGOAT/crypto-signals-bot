import { Env, dbConfig } from "../env";
import { getTrendFilterState } from "../market/trendFilter";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";
import { sendMessage } from "../telegram";
import { getHeartbeat } from "../db/systemHeartbeats";
import { upsertRow, SupabaseConfig } from "../supabaseRest";
import { getOpenSignals, getSignalsResolvedSince } from "../db/signals";
import { pnlEffectif } from "../signalMath";
import { prix } from "../signalFormat";
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

/**
 * Les niveaux du briefing passent par le MÊME formatage que les signaux.
 *
 * Cette fonction avait sa propre règle (`toPrecision(5)` sous 100), et le
 * briefing du 10/08 a donc affiché « 0.089100 » et « 2.2000 » — avec des zéros
 * de queue — pour des niveaux que le message de signal, lui, avait publiés
 * proprement. Deux formats pour le même prix, dans deux messages que l'abonné
 * lit à quelques heures d'écart.
 */
function formatLevel(value: number | null | undefined): string {
  if (value == null) return "—";
  return prix(Number(value));
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

  // L'ÉTAT DU FILTRE EN PREMIER. C'est la question qu'un abonné se pose chaque
  // matin — « pourquoi c'est calme ? » — et la seule à laquelle le briefing
  // pouvait répondre sans qu'il ait à taper /marche. Le taire, c'est laisser un
  // silence de plusieurs semaines ressembler à une panne.
  const trend = await getTrendFilterState().catch(() => null);
  const etatFiltre =
    trend === null
      ? "🌐 État du marché indisponible en ce moment (sources de prix injoignables)."
      : trend.isClosed
        ? `📉 Filtre de tendance FERMÉ — le Bitcoin est ${Math.abs(trend.gapPct).toFixed(1).replace(".", ",")} % sous sa moyenne 200 jours. ` +
          "Les trois moteurs directionnels se taisent ; le carry, le momentum 4H et la faiblesse 4H travaillent."
        : `📈 Filtre de tendance OUVERT — le Bitcoin est ${trend.gapPct.toFixed(1).replace(".", ",")} % au-dessus de sa moyenne 200 jours. ` +
          "Les moteurs directionnels émettent.";

  const lines: string[] = [`🔑 *Briefing VIP — ${now.toISOString().slice(0, 10)}*`, "", etatFiltre, ""];

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
    // Rendement RÉEL, sorties partielles comprises (voir signalMath::pnlEffectif).
    // Le calcul precedent ne voyait que le prix de sortie final, comme si les
    // 30 % vendus a TP1 et les 30 % vendus a TP2 n'avaient jamais existe.
    const total = resolved.reduce((sum, s) => sum + pnlEffectif(s, s.outcome_price ?? null), 0);
    // MOYENNE par signal, pas somme. Additionner les pourcentages de plusieurs
    // trades ne décrit aucun rendement : la somme suppose une mise totale sur
    // chacun, alors que le message de signal conseille 2 %. Même correction que
    // dans /history et /myperformance.
    const moyenne = total / resolved.length;
    const sign = moyenne >= 0 ? "+" : "";
    lines.push(`✅ ${wins} gagnante(s) — ❌ ${losses} perdante(s)`);
    lines.push(`Résultat moyen : ${sign}${moyenne.toFixed(2).replace(".", ",")} % par signal _(sorties partielles Multi-TP comprises, hors frais)_`);
  } else {
    lines.push("_Aucune clôture sur la période._");
  }

  lines.push("");
  lines.push("_État du portefeuille suivi, pas une prévision. Le trading comporte un risque de perte en capital._");

  // Le régulateur décide si le canal peut parler maintenant (channelBudget.ts).
  const verdictBudget = await peutPublier(db, "vip", "quotidien");
  if (!verdictBudget.autorise) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_VIP_CHANNEL_ID), lines.join("\n"), { markdown: true });
  await enregistrerEnvoi(db, "vip", "quotidien", "briefing");
  await recordSent(db);
}
