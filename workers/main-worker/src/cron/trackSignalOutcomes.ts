/**
 * Bloc 4 : suivi automatique des signaux après leur envoi.
 *   1. Vérifie le prix courant (Binance) de chaque signal encore ouvert.
 *   2. Le clôture dès que le take profit ou le stop loss est atteint, ou
 *      après SIGNAL_TIMEOUT_DAYS sans avoir touché ni l'un ni l'autre
 *      (même convention conservatrice que signals/backtest.py et
 *      website/outcome_evaluator.py : un signal expiré compte comme perte).
 *   3. Notifie en DM chaque destinataire réel du signal (signal_deliveries,
 *      pas "tous les actifs au moment de la clôture" — un utilisateur peut
 *      avoir changé de plan entre-temps).
 *   4. Célèbre publiquement les victoires (et annonce calmement les pertes,
 *      sans les cacher) sur le canal public, UNIQUEMENT si ce signal y a
 *      lui-même été diffusé (sent_to_channel) — sinon l'audience du canal
 *      n'a jamais vu l'ouverture et un message de clôture serait confus.
 *
 * Limite assumée (identique à website/outcome_evaluator.py) : comparaison au
 * prix COURANT, pas à l'historique intrabar complet.
 */

import { Env, dbConfig } from "../env";
import { getOpenSignals, markSignalClosed, updateTrailingStop, markTp1Hit, markTp2Hit, SignalRecord } from "../db/signals";
import { getDeliveryRecipients } from "../db/signalDeliveries";
import { filterByPrefEnabled } from "../db/userPrefs";
import { getCurrentPrices, pairToSymbol } from "../market/binancePrices";
import { evaluateOutcome, computePnlPct, computeTrailingStop, evaluateMultiTpProgress, CloseReason } from "../signalMath";
import { sendMessage } from "../telegram";
import { handleAntiStress } from "./antiStress";
import { typeLabel } from "../signalFormat";

const SIGNAL_TIMEOUT_DAYS = 10;
const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

function pctLabel(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function formatSubscriberCloseMessage(signal: SignalRecord, pct: number): string {
  const base = `${typeLabel(signal.type)} ${signal.pair} — entrée ${signal.entry_price}, clôturé à ${signal.outcome_price} (${pctLabel(pct)}).`;

  // Mission "grille d'excellence" : un signal peut se clôturer à 0% après
  // avoir déjà sécurisé TP1 (retour au break-even) ou sur le runner TP3 —
  // deux cas que le message générique "Take profit atteint" rendait confus
  // (0.0% affiché à côté d'un "take profit atteint", ou TP3 traité comme un
  // gain quelconque sans reconnaître le runner).
  const isTp3Win = signal.close_reason === "tp_hit" && signal.tp3_price != null && signal.outcome_price === signal.tp3_price;
  if (isTp3Win) {
    return ["🥉 *TP3 atteint — le runner est allé au bout !* 🚀", base].join("\n");
  }
  const isBreakevenAfterTp1 = signal.close_reason === "tp_hit" && signal.tp1_hit_at != null && signal.outcome_price === signal.entry_price;
  if (isBreakevenAfterTp1) {
    return [
      "🔒 *Clôturé au point mort — TP1 déjà sécurisé*",
      base,
      "Le prix est revenu à l'entrée après ton premier objectif : le gain de TP1 reste acquis, ce trade compte comme un succès.",
    ].join("\n");
  }

  switch (signal.close_reason) {
    case "tp_hit":
      return [`✅ *Take profit atteint*`, base].join("\n");
    case "sl_hit":
      return [
        `❌ *Stop loss touché*`,
        base,
        "La gestion du risque fait partie de la stratégie : le stop loss limite la perte à un niveau connu à l'avance.",
      ].join("\n");
    default:
      return [`⌛ *Signal expiré*`, `${base} Clôturé après ${SIGNAL_TIMEOUT_DAYS} jours sans avoir atteint son objectif ni son stop loss.`].join(
        "\n"
      );
  }
}

function formatPublicCloseMessage(signal: SignalRecord, pct: number, botUsername: string): string {
  const escapedUsername = botUsername.replace(/_/g, "\\_");
  const base = `${typeLabel(signal.type)} ${signal.pair} — entrée ${signal.entry_price} → sortie ${signal.outcome_price} (${pctLabel(pct)}).`;
  if (signal.close_reason === "tp_hit") {
    return [`🎉 *Objectif atteint !*`, base, "", `Envie de ne rater aucun signal comme celui-ci ? Rejoins @${escapedUsername}`].join("\n");
  }
  return [
    `📉 *Signal clôturé*`,
    base,
    "La gestion du risque fait partie de la stratégie : chaque signal a un stop loss défini à l'avance.",
  ].join("\n");
}

function formatTrailingStopUpdate(signal: SignalRecord, newTrailingStop: number): string {
  const previous = signal.trailing_stop_price ?? signal.stop_loss;
  const direction = signal.type === "BUY" ? "remonte" : "baisse";
  return [
    "🔒 *Trailing stop* — mets à jour ton stop",
    `${typeLabel(signal.type)} ${signal.pair} progresse en ta faveur : ${direction} ton stop de ${previous} à ${newTrailingStop} pour sécuriser une partie du gain.`,
    "Purement indicatif — n'affecte pas le stop loss officiel de ce signal.",
  ].join("\n");
}

function formatTp1HitMessage(signal: SignalRecord): string {
  return [
    "🥇 *TP1 sécurisé !*",
    `${typeLabel(signal.type)} ${signal.pair} a atteint son premier objectif (${signal.tp1_price}).`,
    `${signal.stop_loss !== signal.entry_price ? "Le stop passe automatiquement au break-even (prix d'entrée)" : "Stop déjà au break-even"} — ce signal ne peut plus finir perdant.`,
    `Objectif suivant : TP2 (${signal.tp2_price}).`,
  ].join("\n");
}

function formatTp2HitMessage(signal: SignalRecord): string {
  return [
    "🥈 *TP2 atteint — objectif principal !*",
    `${typeLabel(signal.type)} ${signal.pair} a atteint son objectif principal (${signal.tp2_price}).`,
    `Le reste de la position vise maintenant le runner TP3 (${signal.tp3_price}), stop toujours au break-even.`,
  ].join("\n");
}

/** Étape 2 (célébrations) : message festif diffusé sur le canal VIP quand TP2 ou TP3 est atteint. */
function formatCelebrationMessage(signal: SignalRecord, level: "TP2" | "TP3", pct: number): string {
  const medal = level === "TP2" ? "🥈" : "🥉";
  return `${medal} *${level} ATTEINT sur ${signal.pair} !* ${pctLabel(pct)} sécurisés. Félicitations aux abonnés !`;
}

/** Étape 2 : texte simple (pas d'image) que l'abonné peut copier-coller sur ses réseaux. */
function formatShareableVictory(signal: SignalRecord, pct: number, botUsername: string): string {
  const escapedUsername = botUsername.replace(/_/g, "\\_");
  return [
    "📣 *À partager si tu veux :*",
    `\`🎯 ${pctLabel(pct)} sur ${signal.pair} avec @${escapedUsername} ! Trade sécurisé automatiquement. Rejoignez l'essai gratuit.\``,
  ].join("\n");
}

async function broadcastCelebration(env: Env, signal: SignalRecord, level: "TP2" | "TP3", pct: number): Promise<void> {
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;
  const channelId = Number(env.TELEGRAM_VIP_CHANNEL_ID);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatCelebrationMessage(signal, level, pct), { markdown: true }).catch((err) =>
    console.error(`[post-trade] Échec de la célébration VIP pour le signal #${signal.id} (${level}):`, err)
  );
}

async function closeSignal(
  env: Env,
  db: ReturnType<typeof dbConfig>,
  signal: SignalRecord,
  outcome: "WIN" | "LOSS",
  outcomePrice: number | null,
  closeReason: CloseReason
): Promise<void> {
  await markSignalClosed(db, signal.id, { outcome, outcomePrice, closeReason });

  const closedSignal: SignalRecord = { ...signal, outcome, outcome_price: outcomePrice, close_reason: closeReason };
  const pct = outcomePrice !== null ? computePnlPct(signal.type, signal.entry_price, outcomePrice) : 0;

  const recipients = await getDeliveryRecipients(db, signal.id);
  await notifyRecipients(env, recipients, formatSubscriberCloseMessage(closedSignal, pct));
  await handleAntiStress(env, recipients, outcome).catch((err) =>
    console.error(`[post-trade] Échec du mécanisme anti-stress pour le signal #${signal.id}:`, err)
  );

  if (signal.sent_to_channel && env.TELEGRAM_CHANNEL_ID) {
    const channelId = Number(env.TELEGRAM_CHANNEL_ID);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatPublicCloseMessage(closedSignal, pct, env.TELEGRAM_BOT_USERNAME), {
      markdown: true,
    }).catch((err) => console.error(`[post-trade] Échec de la célébration publique pour le signal #${signal.id}:`, err));
  }
}

async function notifyRecipients(env: Env, telegramIds: number[], text: string): Promise<void> {
  for (let i = 0; i < telegramIds.length; i += BATCH_SIZE) {
    const batch = telegramIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((id) =>
        sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true }).catch((err) =>
          console.error(`[post-trade] Échec de notification à ${id}:`, err)
        )
      )
    );
    if (i + BATCH_SIZE < telegramIds.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }
}

export async function trackSignalOutcomes(env: Env): Promise<void> {
  const db = dbConfig(env);
  const open = await getOpenSignals(db);
  if (open.length === 0) return;

  const symbols = Array.from(new Set(open.map((s) => pairToSymbol(s.pair))));
  let prices: Record<string, number>;
  try {
    prices = await getCurrentPrices(symbols);
  } catch (err) {
    console.error("[post-trade] Échec de récupération des prix Binance, nouvelle tentative au prochain cycle:", err);
    return;
  }

  const now = Date.now();

  for (const signal of open) {
    const currentPrice = prices[pairToSymbol(signal.pair)];
    const isMultiTp = signal.tp1_price != null;

    // Mission "grille d'excellence" : progression TP1 (sécurisation +
    // break-even) -> TP2 -> TP3, au lieu d'un SL/TP binaire. Les signaux
    // générés avant ce changement (tp1_price absent) suivent l'ancienne
    // logique evaluateOutcome, inchangée.
    if (isMultiTp && currentPrice !== undefined) {
      const progress = evaluateMultiTpProgress(
        {
          type: signal.type,
          entryPrice: signal.entry_price,
          stopLoss: signal.stop_loss,
          tp1Price: signal.tp1_price ?? null,
          tp2Price: signal.tp2_price ?? null,
          tp3Price: signal.tp3_price ?? null,
          tp1HitAt: signal.tp1_hit_at ?? null,
          tp2HitAt: signal.tp2_hit_at ?? null,
          tp3HitAt: signal.tp3_hit_at ?? null,
          breakevenActive: signal.breakeven_active ?? false,
        },
        currentPrice
      );

      if (progress.kind === "tp1_hit") {
        await markTp1Hit(db, signal.id);
        const recipients = await getDeliveryRecipients(db, signal.id);
        await notifyRecipients(env, recipients, formatTp1HitMessage(signal));
        continue;
      }
      if (progress.kind === "tp2_hit") {
        await markTp2Hit(db, signal.id);
        const recipients = await getDeliveryRecipients(db, signal.id);
        const pctAtTp2 = computePnlPct(signal.type, signal.entry_price, signal.tp2_price ?? signal.entry_price);
        await notifyRecipients(env, recipients, formatTp2HitMessage(signal));
        await notifyRecipients(env, recipients, formatShareableVictory(signal, pctAtTp2, env.TELEGRAM_BOT_USERNAME));
        await broadcastCelebration(env, signal, "TP2", pctAtTp2);
        continue;
      }
      if (progress.kind === "closed") {
        // TP3 (le runner) est le seul cas de "closed" qui merite une
        // celebration -- une sortie via break-even ou stop initial est deja
        // couverte par formatSubscriberCloseMessage, pas de doublon festif.
        const isTp3Win = signal.tp3_price != null && progress.outcome === "WIN" && progress.exitPrice === signal.tp3_price;
        if (isTp3Win) {
          const recipients = await getDeliveryRecipients(db, signal.id);
          const pctAtTp3 = computePnlPct(signal.type, signal.entry_price, progress.exitPrice);
          await notifyRecipients(env, recipients, formatShareableVictory(signal, pctAtTp3, env.TELEGRAM_BOT_USERNAME));
          await broadcastCelebration(env, signal, "TP3", pctAtTp3);
        }
        await closeSignal(env, db, signal, progress.outcome, progress.exitPrice, progress.closeReason);
        continue;
      }
      // "none" : ni niveau franchi ni stop touché -> vérifie le timeout ci-dessous.
    }

    const hit =
      !isMultiTp && currentPrice !== undefined ? evaluateOutcome(signal.type, signal.stop_loss, signal.take_profit, currentPrice) : null;

    const ageDays = (now - new Date(signal.created_at).getTime()) / (24 * 60 * 60 * 1000);
    let outcome: "WIN" | "LOSS";
    let closeReason: CloseReason;
    if (hit) {
      outcome = hit.outcome;
      closeReason = hit.closeReason;
    } else if (ageDays >= SIGNAL_TIMEOUT_DAYS) {
      // Un signal Multi-TP qui a déjà sécurisé TP1 avant d'expirer reste un
      // succès (voir signals/backtest.py::_simulate_multi_tp_exit, même
      // convention) : on ne pénalise jamais un trade déjà passé au
      // break-even, contrairement à un signal classique jamais sécurisé.
      if (isMultiTp && signal.tp1_hit_at) {
        outcome = "WIN";
        closeReason = "tp_hit";
      } else {
        outcome = "LOSS";
        closeReason = "expired";
      }
    } else {
      // UX — trailing stop optionnel (/prefs, opt-in) : toujours ouvert, mais
      // le prix a peut-être assez progressé pour remonter le niveau indicatif.
      // Aucun impact sur stop_loss/take_profit/outcome (voir signalMath.ts).
      if (currentPrice !== undefined) {
        const newTrailingStop = computeTrailingStop(signal.type, signal.entry_price, signal.stop_loss, signal.trailing_stop_price, currentPrice);
        if (newTrailingStop !== null) {
          await updateTrailingStop(db, signal.id, newTrailingStop);
          const recipients = await getDeliveryRecipients(db, signal.id);
          const trailingRecipients = await filterByPrefEnabled(db, recipients, "trailing_stop");
          await notifyRecipients(env, trailingRecipients, formatTrailingStopUpdate(signal, newTrailingStop));
        }
      }
      continue; // toujours ouvert
    }

    const outcomePrice = currentPrice ?? null;
    await closeSignal(env, db, signal, outcome, outcomePrice, closeReason);
  }
}
