/**
 * ÉTAPE 5 — mécanisme anti-stress : après 2 pertes consécutives sur des
 * signaux réels, rappelle le taux de réussite long terme à l'abonné plutôt
 * que de le laisser seul face à une série de pertes. Célèbre aussi
 * légèrement un take profit. Uniquement pour les abonnés PAYANTS (plan != 0
 * = essai gratuit) : un essai gratuit n'a pas encore d'enjeu financier réel.
 */

import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { getUsersByIds, setConsecutiveLosses, UserRecord } from "../db/users";
import { getActiveStrategyParams } from "../db/strategyParams";

const CONSECUTIVE_LOSSES_THRESHOLD = 2;
const TRIAL_PLAN = 0;

/**
 * Contexte factuel joint au message de réassurance.
 *
 * Réécrit le 01/08/2026. L'ancienne version affirmait qu'« une série de
 * pertes ne remet pas en cause la stratégie sur la durée » — autrement dit
 * que la stratégie est saine sur le long terme. Or la mesure walk-forward
 * sur 24 mois donne une espérance NÉGATIVE (-0,019%/trade, voir
 * signals/DIAGNOSTIC_SIGNAUX_2026-08-01.md). Affirmer le contraire à un
 * client PAYANT, au moment précis où il vient d'enchaîner deux pertes, est
 * la pire forme de réassurance : elle l'encourage à rester exposé sur la
 * foi d'une promesse que nos propres données contredisent.
 *
 * Ce qui reste vrai et utile dans ce message, c'est le conseil de
 * comportement (ne pas doubler la mise, ne pas déplacer son stop). Il est
 * conservé ; la promesse sur la stratégie, non.
 */
async function buildContextPhrase(env: Env): Promise<string> {
  const neutral =
    "deux pertes d'affilée sont statistiquement banales, y compris sur une stratégie qui fonctionne — " +
    "mais elles ne prouvent pas non plus qu'elle fonctionne";
  if (env.DISPLAY_WINRATE !== "true") return neutral;
  try {
    const stats = await getActiveStrategyParams(dbConfig(env));
    if (!stats) return neutral;
    // Le taux de réussite n'est jamais donné seul : sans le rapport
    // gains/pertes moyens, il laisse croire à une rentabilité qui n'est pas
    // démontrée (voir le même correctif sur le site et dans /faq).
    return (
      `${(stats.win_rate * 100).toFixed(0)}% des trades atteignent leur premier objectif, ` +
      "ce qui ne signifie pas pour autant que la stratégie soit rentable"
    );
  } catch {
    return neutral;
  }
}

/**
 * Appelé par trackSignalOutcomes.ts pour chaque destinataire d'un signal
 * clôturé. Met à jour le compteur de pertes consécutives et envoie le
 * message adapté — jamais bloquant pour le reste du cycle (best-effort).
 */
export async function handleAntiStress(env: Env, recipients: number[], outcome: "WIN" | "LOSS"): Promise<void> {
  if (recipients.length === 0) return;
  const db = dbConfig(env);

  let users: UserRecord[];
  try {
    users = await getUsersByIds(db, recipients);
  } catch (err) {
    console.error("[anti-stress] Échec de récupération des utilisateurs:", err);
    return;
  }

  const payingUsers = users.filter((u) => u.plan !== TRIAL_PLAN);
  if (payingUsers.length === 0) return;

  if (outcome === "WIN") {
    await Promise.all(
      payingUsers
        .filter((u) => u.consecutive_losses > 0)
        .map((u) => setConsecutiveLosses(db, u.telegram_id, 0).catch((err) => console.error(`[anti-stress] Échec reset pour ${u.telegram_id}:`, err)))
    );
    await Promise.all(
      payingUsers.map((u) =>
        sendMessage(env.TELEGRAM_BOT_TOKEN, u.telegram_id, "🎉 Take profit dans la poche ! Bien joué, on continue comme ça. 💪").catch((err) =>
          console.error(`[anti-stress] Échec célébration pour ${u.telegram_id}:`, err)
        )
      )
    );
    return;
  }

  // LOSS : incrémente, et rassure uniquement au moment où le seuil est atteint
  // (pas à chaque perte supplémentaire au-delà, pour ne pas être lourd).
  const contextPhrase = await buildContextPhrase(env);
  await Promise.all(
    payingUsers.map(async (u) => {
      const newCount = u.consecutive_losses + 1;
      try {
        await setConsecutiveLosses(db, u.telegram_id, newCount);
      } catch (err) {
        console.error(`[anti-stress] Échec incrément pour ${u.telegram_id}:`, err);
        return;
      }
      if (newCount === CONSECUTIVE_LOSSES_THRESHOLD) {
        await sendMessage(
          env.TELEGRAM_BOT_TOKEN,
          u.telegram_id,
          `📊 Deux pertes consécutives récentes — ${contextPhrase}.\n\n` +
            "Ce qui compte maintenant : ne double pas la mise pour \"te refaire\" (c'est l'erreur " +
            "la plus coûteuse en trading), ne déplace pas ton stop, et garde la même taille de " +
            "position qu'avant. Si ces pertes dépassent ce que tu peux te permettre, réduis la " +
            "taille ou mets en pause — c'est une décision saine, pas un abandon."
        ).catch((err) => console.error(`[anti-stress] Échec message de réassurance pour ${u.telegram_id}:`, err));
      }
    })
  );
}
