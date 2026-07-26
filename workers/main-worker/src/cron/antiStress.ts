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

async function buildWinRatePhrase(env: Env): Promise<string> {
  if (env.DISPLAY_WINRATE !== "true") {
    return "la stratégie est backtestée sur 24 mois de données réelles et suivie en continu";
  }
  try {
    const stats = await getActiveStrategyParams(dbConfig(env));
    if (!stats) return "la stratégie est backtestée sur 24 mois de données réelles et suivie en continu";
    return `le taux de réussite est de ${(stats.win_rate * 100).toFixed(0)}%`;
  } catch {
    return "la stratégie est backtestée sur 24 mois de données réelles et suivie en continu";
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
  const winRatePhrase = await buildWinRatePhrase(env);
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
          `📊 Deux pertes consécutives récentes. Rappel : ${winRatePhrase} — une série de pertes ne remet pas en cause la stratégie sur la durée. Reste discipliné, ne double pas la mise pour "te refaire".`
        ).catch((err) => console.error(`[anti-stress] Échec message de réassurance pour ${u.telegram_id}:`, err));
      }
    })
  );
}
