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
import { getOpenSignals, markSignalClosed, SignalRecord } from "../db/signals";
import { getDeliveryRecipients } from "../db/signalDeliveries";
import { getCurrentPrices, pairToSymbol } from "../market/binancePrices";
import { evaluateOutcome, computePnlPct, CloseReason } from "../signalMath";
import { sendMessage } from "../telegram";

const SIGNAL_TIMEOUT_DAYS = 10;
const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

function pctLabel(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function formatSubscriberCloseMessage(signal: SignalRecord, pct: number): string {
  const base = `${signal.type} ${signal.pair} — entrée ${signal.entry_price}, clôturé à ${signal.outcome_price} (${pctLabel(pct)}).`;
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
  const base = `${signal.type} ${signal.pair} — entrée ${signal.entry_price} → sortie ${signal.outcome_price} (${pctLabel(pct)}).`;
  if (signal.close_reason === "tp_hit") {
    return [`🎉 *Objectif atteint !*`, base, "", `Envie de ne rater aucun signal comme celui-ci ? Rejoins @${escapedUsername}`].join("\n");
  }
  return [
    `📉 *Signal clôturé*`,
    base,
    "La gestion du risque fait partie de la stratégie : chaque signal a un stop loss défini à l'avance.",
  ].join("\n");
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
    const hit = currentPrice !== undefined ? evaluateOutcome(signal.type, signal.stop_loss, signal.take_profit, currentPrice) : null;

    const ageDays = (now - new Date(signal.created_at).getTime()) / (24 * 60 * 60 * 1000);
    let outcome: "WIN" | "LOSS";
    let closeReason: CloseReason;
    if (hit) {
      outcome = hit.outcome;
      closeReason = hit.closeReason;
    } else if (ageDays >= SIGNAL_TIMEOUT_DAYS) {
      outcome = "LOSS";
      closeReason = "expired";
    } else {
      continue; // toujours ouvert
    }

    const outcomePrice = currentPrice ?? null;
    await markSignalClosed(db, signal.id, { outcome, outcomePrice, closeReason });

    const closedSignal: SignalRecord = { ...signal, outcome, outcome_price: outcomePrice, close_reason: closeReason };
    const pct = outcomePrice !== null ? computePnlPct(signal.type, signal.entry_price, outcomePrice) : 0;

    const recipients = await getDeliveryRecipients(db, signal.id);
    await notifyRecipients(env, recipients, formatSubscriberCloseMessage(closedSignal, pct));

    if (signal.sent_to_channel && env.TELEGRAM_CHANNEL_ID) {
      const channelId = Number(env.TELEGRAM_CHANNEL_ID);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatPublicCloseMessage(closedSignal, pct, env.TELEGRAM_BOT_USERNAME), {
        markdown: true,
      }).catch((err) => console.error(`[post-trade] Échec de la célébration publique pour le signal #${signal.id}:`, err));
    }
  }
}
