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
import { buildReferralLink, REFERRAL_BONUS_DAYS } from "../bot/referral";

// Filet de sécurité, utilisé UNIQUEMENT quand le signal ne porte pas sa propre
// échéance (signaux antérieurs à hold_until). Voir holdDeadlineMs ci-dessous :
// chaque moteur a été validé sur SA durée de détention, pas sur celle-ci.
const SIGNAL_TIMEOUT_DAYS = 10;
const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

/**
 * Instant de clôture temporelle d'un signal.
 *
 * Chaque moteur a été mesuré avec une sortie temporelle qui lui est propre :
 * 7 jours pour la force relative, 3 jours pour le momentum 4 h. Les tenir tous
 * 10 jours ne serait PAS la stratégie validée — et l'écart n'est pas anodin :
 * le momentum 4 h ne travaille qu'en marché baissier, précisément le régime où
 * garder une position longue trois fois trop longtemps efface le gain mesuré.
 *
 * On lit donc l'échéance portée par le signal lui-même, et on ne retombe sur
 * la constante que pour les signaux émis avant l'introduction de la colonne.
 */
function holdDeadlineMs(signal: SignalRecord): number {
  if (signal.hold_until) {
    const echeance = new Date(signal.hold_until).getTime();
    if (Number.isFinite(echeance)) return echeance;
  }
  return new Date(signal.created_at).getTime() + SIGNAL_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
}

/** Durée de détention prévue, en jours, pour l'annoncer telle qu'elle a été tenue. */
function holdDurationDays(signal: SignalRecord): number {
  const jours = (holdDeadlineMs(signal) - new Date(signal.created_at).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(1, Math.round(jours));
}

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
      return [
        `⌛ *Signal clôturé à l'échéance*`,
        `${base} Fermé après ${holdDurationDays(signal)} jours, la durée prévue pour ce signal, sans avoir atteint son objectif ni son stop loss.`,
        "La sortie au bout d'une durée fixe fait partie de la stratégie : c'est ainsi qu'elle a été mesurée.",
      ].join("\n");
  }
}

/**
 * Clôture sur le canal PUBLIC : le signal entier, cette fois.
 *
 * C'est la contrepartie du format d'annonce sans niveaux (voir
 * signalFormat.buildPublicTeaserMessage). À l'ouverture, le canal gratuit
 * apprend qu'un signal part et de quel moteur ; à la clôture, il reçoit TOUT —
 * les niveaux qui avaient été réservés, le résultat, et le pourcentage.
 *
 * Sans ces niveaux ici, le relevé public serait invérifiable : « ce signal a
 * gagné 4 % » ne veut rien dire si l'on ne sait ni où il entrait ni où il
 * s'arrêtait. Les publier après coup ne coûte rien — le trade est terminé — et
 * c'est ce qui transforme une affirmation en démonstration.
 *
 * Les pertes sont publiées exactement au même endroit, dans le même format, et
 * sans adoucissement. Un canal qui ne montrerait que ses gains ne prouverait
 * rien du tout.
 */
function formatPublicCloseMessage(signal: SignalRecord, pct: number, botUsername: string): string {
  const escapedUsername = botUsername.replace(/_/g, "\\_");
  const gagnant = signal.outcome === "WIN";
  const titre = gagnant ? "✅ *Signal clôturé — gagnant*" : "❌ *Signal clôturé — perdant*";

  const niveaux: string[] = [`💵 Entrée : ${signal.entry_price}`];
  if (signal.stop_loss != null) niveaux.push(`🛑 Stop : ${signal.stop_loss}`);
  if (signal.tp1_price != null) niveaux.push(`🥇 TP1 : ${signal.tp1_price}`);
  if (signal.tp2_price != null) niveaux.push(`🥈 TP2 : ${signal.tp2_price}`);
  if (signal.tp3_price != null) niveaux.push(`🥉 TP3 : ${signal.tp3_price}`);

  const cause =
    signal.close_reason === "tp_hit"
      ? "Objectif atteint."
      : signal.close_reason === "sl_hit"
        ? "Stop loss touché. La perte était bornée à l'avance — c'est à ça que sert un stop."
        : `Clôturé à l'échéance, ${holdDurationDays(signal)} jours après l'ouverture, sans avoir touché ni l'objectif ni le stop.`;

  return [
    titre,
    `${typeLabel(signal.type)} *${signal.pair}* — sortie à ${signal.outcome_price} (*${pctLabel(pct)}*)`,
    "",
    "_Les niveaux tels qu'ils avaient été envoyés aux abonnés :_",
    ...niveaux,
    "",
    cause,
    "",
    "📊 Chaque signal est republié ici à sa clôture, gagnant ou perdant, avec ses niveaux d'origine. " +
      "Rien n'est retiré après coup.",
    "",
    `🎁 Pour les recevoir au moment où ils partent : @${escapedUsername} — essai gratuit de 3 jours.`,
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

/**
 * Message festif du canal VIP quand TP2 ou TP3 est atteint.
 *
 * Le rappel du parrainage est en deuxième ligne, court, et jamais à la place de
 * la nouvelle. Ce canal est lu par des abonnés payants : c'est exactement le
 * public qui peut recommander le produit, et le seul instant où il en a envie.
 */
function formatCelebrationMessage(signal: SignalRecord, level: "TP2" | "TP3", pct: number): string {
  const medal = level === "TP2" ? "🥈" : "🥉";
  return [
    `${medal} *${level} ATTEINT sur ${signal.pair} !* ${pctLabel(pct)} sécurisés. Félicitations aux abonnés !`,
    `🤝 Envie d'en parler ? /referral te donne ton lien : ${REFERRAL_BONUS_DAYS} jours offerts par personne qui s'abonne.`,
  ].join("\n");
}

/**
 * Texte que l'abonné peut copier-coller sur ses réseaux, PORTANT SON PROPRE
 * LIEN DE PARRAINAGE.
 *
 * Il n'en portait aucun : on demandait à quelqu'un qui vient de gagner de faire
 * la promotion du produit, et on ne lui en rendait rien. Avec son lien, le même
 * partage lui rapporte REFERRAL_BONUS_DAYS jours d'accès par personne qui
 * s'abonne, et donne une remise à celle qui clique.
 *
 * C'est aussi le seul moment du parcours où la demande est naturelle : juste
 * après une victoire, sur un message qu'il a envie de montrer. Proposé à froid,
 * le parrainage se lit comme une sollicitation ; proposé ici, comme une occasion.
 */
function formatShareableVictory(signal: SignalRecord, pct: number, env: Env, telegramId: number): string {
  const lien = buildReferralLink(env, telegramId);
  return [
    "📣 *À partager si tu veux — avec TON lien :*",
    `\`🎯 ${pctLabel(pct)} sur ${signal.pair} ! Signaux crypto mesurés sur 6 ans, essai gratuit de 3 jours : ${lien}\``,
    "",
    `🤝 Chaque personne qui s'abonne via ce lien t'offre ${REFERRAL_BONUS_DAYS} jours d'accès, et lui donne une remise. Ton suivi complet : /referral`,
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
  closeReason: CloseReason,
  /** Texte personnalisé ajouté au message de clôture, par destinataire. */
  supplement?: (telegramId: number) => string
): Promise<void> {
  await markSignalClosed(db, signal.id, { outcome, outcomePrice, closeReason });

  const closedSignal: SignalRecord = { ...signal, outcome, outcome_price: outcomePrice, close_reason: closeReason };
  const pct = outcomePrice !== null ? computePnlPct(signal.type, signal.entry_price, outcomePrice) : 0;

  const recipients = await getDeliveryRecipients(db, signal.id);
  const messageCloture = formatSubscriberCloseMessage(closedSignal, pct);
  if (supplement) {
    await notifyEachRecipient(env, recipients, (id) => `${messageCloture}\n\n${supplement(id)}`);
  } else {
    await notifyRecipients(env, recipients, messageCloture);
  }
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

/**
 * Comme notifyRecipients, mais le texte est CONSTRUIT PAR DESTINATAIRE.
 *
 * Nécessaire dès qu'un message contient quelque chose de personnel — ici le
 * lien de parrainage. Même découpage en lots et même traitement des erreurs :
 * un envoi qui échoue ne doit jamais interrompre les autres.
 */
async function notifyEachRecipient(env: Env, telegramIds: number[], build: (id: number) => string): Promise<void> {
  for (let i = 0; i < telegramIds.length; i += BATCH_SIZE) {
    const batch = telegramIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((id) =>
        sendMessage(env.TELEGRAM_BOT_TOKEN, id, build(id), { markdown: true }).catch((err) =>
          console.error(`[post-trade] Échec de notification à ${id}:`, err)
        )
      )
    );
    if (i + BATCH_SIZE < telegramIds.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
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

  const pairs = Array.from(new Set(open.map((s) => s.pair)));
  const prices = await getCurrentPrices(pairs);

  const now = Date.now();

  for (const signal of open) {
    // getOpenSignals a déjà écarté les carrys, seuls signaux dont le stop et
    // l'objectif peuvent être nuls. On le rend explicite ici : un signal
    // directionnel sans stop est une anomalie d'insertion, et le suivre
    // produirait des clôtures arbitraires.
    if (signal.stop_loss == null || signal.take_profit == null) {
      console.error(`[post-trade] ${signal.pair} (#${signal.id}) ignoré : stop ou objectif absent sur un signal directionnel.`);
      continue;
    }
    const stopLoss = signal.stop_loss;
    const takeProfit = signal.take_profit;
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
        // UN seul message, pas deux. L'annonce du TP2 et le texte partageable
        // partaient dos à dos dans la même seconde : deux notifications pour un
        // seul événement, c'est la définition du spam. Assemblés, ils se lisent
        // mieux — la bonne nouvelle, puis quoi en faire.
        await notifyEachRecipient(env, recipients, (id) =>
          `${formatTp2HitMessage(signal)}\n\n${formatShareableVictory(signal, pctAtTp2, env, id)}`
        );
        await broadcastCelebration(env, signal, "TP2", pctAtTp2);
        continue;
      }
      if (progress.kind === "closed") {
        // TP3 (le runner) est le seul cas de "closed" qui merite une
        // celebration -- une sortie via break-even ou stop initial est deja
        // couverte par formatSubscriberCloseMessage, pas de doublon festif.
        const isTp3Win = signal.tp3_price != null && progress.outcome === "WIN" && progress.exitPrice === signal.tp3_price;
        if (isTp3Win) {
          const pctAtTp3 = computePnlPct(signal.type, signal.entry_price, progress.exitPrice);
          await broadcastCelebration(env, signal, "TP3", pctAtTp3);
          // Le texte partageable voyage AVEC le message de clôture au lieu de le
          // précéder d'une seconde : deux notifications pour la même nouvelle
          // n'apportaient rien, sinon une vibration de plus.
          await closeSignal(env, db, signal, progress.outcome, progress.exitPrice, progress.closeReason, (id) =>
            formatShareableVictory(signal, pctAtTp3, env, id)
          );
        } else {
          await closeSignal(env, db, signal, progress.outcome, progress.exitPrice, progress.closeReason);
        }
        continue;
      }
      // "none" : ni niveau franchi ni stop touché -> vérifie le timeout ci-dessous.
    }

    const hit =
      !isMultiTp && currentPrice !== undefined ? evaluateOutcome(signal.type, stopLoss, takeProfit, currentPrice) : null;

    let outcome: "WIN" | "LOSS";
    let closeReason: CloseReason;
    if (hit) {
      outcome = hit.outcome;
      closeReason = hit.closeReason;
    } else if (now >= holdDeadlineMs(signal)) {
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
