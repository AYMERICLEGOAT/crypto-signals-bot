/**
 * Bloc 12.3 : récap hebdomadaire publié sur le canal public tous les
 * dimanches à partir de 18h UTC (le cron tourne toutes les 5 minutes, voir
 * index.ts -- ce module se déclenche lui-même seulement le bon jour/heure,
 * et le gate "déjà publié cette semaine" empêche les envois multiples le
 * reste du dimanche soir).
 */

import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { hasPostedWeeklyRecapRecently, recordWeeklyRecapPost } from "../db/weeklyRecapPosts";
import { getSignalsCreatedSince, getSignalsResolvedSince, getOpenSignals } from "../db/signals";
import { getMomentumAlertsSince } from "../db/momentumAlerts";
import { computePnlPct } from "../signalMath";
import { getTrendFilterState } from "../market/trendFilter";
import { isQuietHours } from "../utils/quietHours";
import { PART_FILTRE_FERME } from "../publishedStats";
import { enregistrerEnvoi } from "../channelBudget";

const RECAP_WEEKDAY_UTC = 0; // dimanche
const RECAP_HOUR_UTC = 18;
const PAPER_POSITION_SIZE_PCT = 0.1; // même convention que website/equity_curve.py

export async function dispatchWeeklyRecap(env: Env): Promise<void> {
  // Aucune publication dans le canal public la nuit (voir
  // utils/quietHours.ts). Le drapeau "deja envoye" en base fait que
  // sauter un cycle nocturne DIFFERE la publication au premier cycle
  // apres 7h UTC, il ne la perd pas.
  if (isQuietHours()) return;
  if (!env.TELEGRAM_CHANNEL_ID) return;

  const now = new Date();
  if (now.getUTCDay() !== RECAP_WEEKDAY_UTC || now.getUTCHours() < RECAP_HOUR_UTC) return;

  const db = dbConfig(env);
  if (await hasPostedWeeklyRecapRecently(db)) return;

  const weekAgoIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [emitted, resolved, momentumAlerts] = await Promise.all([
    getSignalsCreatedSince(db, weekAgoIso),
    getSignalsResolvedSince(db, weekAgoIso),
    getMomentumAlertsSince(db, weekAgoIso),
  ]);

  // Semaine entièrement vide : le filtre de tendance a tenu la stratégie hors
  // marché du lundi au dimanche. La grille habituelle alignerait alors six
  // zéros -- et le referait CHAQUE dimanche pendant toute la fermeture, qui a
  // déjà duré 381 jours d'affilée une fois en 6 ans. Un récap qui explique
  // vaut mieux qu'un tableau vide répété cinquante fois.
  //
  // Pas d'appel commercial dans cette variante, à la différence du récap
  // normal : proposer « des signaux en temps réel » au bas d'un bilan qui
  // annonce zéro signal est incohérent, et le CTA existe déjà par ailleurs
  // (cron/postChannelReminder.ts).
  if (emitted.length === 0 && resolved.length === 0) {
    const state = await getTrendFilterState();
    const silentText = [
      "📅 *Récap de la semaine — aucun signal émis*",
      "",
      state?.isClosed
        ? `Le Bitcoin est resté sous sa moyenne mobile 200 jours (${Math.abs(state.gapPct).toFixed(1).replace(".", ",")} % en dessous à la dernière clôture). Le filtre de tendance a donc tenu la stratégie hors marché toute la semaine.`
        : "Aucune configuration n'a rempli les critères de la stratégie cette semaine.",
      "",
      `Ce filtre est fermé ${PART_FILTRE_FERME} du temps. Sans lui, la stratégie n'est positive que 4 années sur 7 ; avec lui, elle n'a aucune année perdante sur 6 ans.`,
      "",
      "⚠️ Pas un conseil en investissement. Performance passée ne garantit pas les résultats futurs.",
    ].join("\n");

    await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), silentText, { markdown: true });
    await enregistrerEnvoi(db, "public", "quotidien", "recap-hebdo");
    await recordWeeklyRecapPost(db);
    return;
  }

  const tpCount = resolved.filter((s) => s.close_reason === "tp_hit").length;
  const slCount = resolved.filter((s) => s.close_reason === "sl_hit").length;

  const paperPnlPct = resolved.reduce((sum, s) => {
    if (s.outcome_price == null) return sum;
    return sum + computePnlPct(s.type, s.entry_price, s.outcome_price) * PAPER_POSITION_SIZE_PCT;
  }, 0);

  // "Sécurisé" = TP1 atteint, donc stop remonté au prix d'entrée : le trade ne
  // peut plus finir perdant. C'est le chiffre signature du produit (voir
  // MULTI_TP_TP1_WEIGHT côté signals/config.py) et il manquait au récap, qui
  // n'affichait que TP/SL — deux issues finales, alors que la sécurisation est
  // justement ce qui distingue cette gestion de sortie.
  const secured = resolved.filter((s) => s.tp1_hit_at != null).length;
  const securedPct = resolved.length ? Math.round((secured / resolved.length) * 100) : 0;

  const escapedUsername = env.TELEGRAM_BOT_USERNAME?.replace(/_/g, "\\_");
  const cta = escapedUsername ? `\n@${escapedUsername} pour des signaux en temps réel` : "";

  const lines = ["📅 *Récap de la semaine*", "", `📡 ${emitted.length} signal(aux) émis`];

  // Les lignes de clôture n'ont de sens que s'il y a eu des clôtures. Le moteur
  // Force Relative tient ses positions 7 jours : la semaine qui suit une
  // réouverture du filtre a normalement des signaux émis et AUCUN résolu --
  // afficher alors « 0 % des clôturés » (un pourcentage calculé sur zéro),
  // « 0 take profit / 0 stop loss » et un portefeuille à +0,0 % décrirait
  // comme un résultat ce qui n'est qu'une absence de données.
  if (resolved.length > 0) {
    const sign = paperPnlPct >= 0 ? "+" : "";
    lines.push(
      `🔒 ${secured} trade(s) sécurisé(s) (TP1 atteint, ne peut plus finir perdant) — ${securedPct} % des clôturés`,
      `✅ ${tpCount} take profit touché(s) — ❌ ${slCount} stop loss touché(s)`,
      // Virgule française et espace insécable avant le signe, comme partout
      // ailleurs : le récap publiait « +1.5% » à côté de « 42 % ».
      `💼 Portefeuille fictif (10 %/trade, non composé) : ${sign}${paperPnlPct.toFixed(1).replace(".", ",")} %`
    );
  } else {
    // « Aucune position clôturée » se lit comme « il ne s'est rien passé », et
    // c'est faux : les positions courent. Sur un produit qui tient ses trades
    // entre 3 et 21 jours selon le moteur, la plupart des semaines n'ont AUCUNE
    // clôture — ce message était donc le plus fréquent du canal, et le plus
    // décourageant.
    //
    // Le nombre de positions réellement ouvertes est la preuve que la machine
    // travaille, et il annonce ce qui va être publié. Lecture tolérante à
    // l'échec : le récap doit partir même si ce comptage tombe.
    let ouvertes = 0;
    try {
      ouvertes = (await getOpenSignals(db)).length;
    } catch (err) {
      console.error("[recap] Comptage des positions ouvertes indisponible :", err);
    }
    lines.push(
      ouvertes > 0
        ? `⏳ Aucune clôture cette semaine, et c'est normal : ${ouvertes} position(s) sont en cours. Les durées ` +
            "vont de 3 jours (momentum 4H) à 21 jours (carry). Chacune sera republiée ICI à sa clôture, en " +
            "entier et avec son résultat — gagnant ou perdant."
        : "⏳ Aucune position clôturée cette semaine (les durées vont de 3 à 21 jours selon le moteur)."
    );
  }

  // Les alertes momentum proviennent des moteurs Haute Confiance et Squeeze,
  // tous deux désactivés depuis le 03/08 (voir signals/config.py) : la ligne
  // afficherait désormais « 0 alerte » toutes les semaines. On ne la garde que
  // si elle a quelque chose à dire.
  if (momentumAlerts.length > 0) {
    lines.push(`⚡ ${momentumAlerts.length} alerte(s) momentum envoyée(s)`);
  }

  lines.push(
    "",
    "⚠️ Pas un conseil en investissement. Performance passée ne garantit pas les résultats futurs.",
    cta
  );
  const text = lines.join("\n");

  // Non GATE par le regulateur : hebdomadaire, deja verrouille par le jour,
  // l heure et hasPostedWeeklyRecapRecently. Mais COMPTABILISE, sinon il
  // pousserait la journee au-dela du plafond sans que rien ne le sache.
  await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_CHANNEL_ID), text, { markdown: true });
  await enregistrerEnvoi(db, "public", "quotidien", "recap-hebdo");
  await recordWeeklyRecapPost(db);
}
