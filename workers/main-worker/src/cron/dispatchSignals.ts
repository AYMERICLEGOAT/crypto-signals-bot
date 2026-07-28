import { Env, dbConfig } from "../env";
import { getUnsentSignals, markSignalSent, SignalRecord } from "../db/signals";
import { getActiveUsers } from "../db/users";
import { filterByPrefEnabled } from "../db/userPrefs";
import { recordDeliveries } from "../db/signalDeliveries";
import { sendMessage, sendPhoto } from "../telegram";
import { PRO_PLAN } from "../payments/plans";
import { buildSignalMessage } from "../signalFormat";

const TRIAL_PLAN = 0;

// Sous-lots envoyés en parallèle, avec une pause entre chaque lot : reste
// sous la limite globale de l'API Telegram (~30 messages/seconde) même avec
// un grand nombre d'abonnés actifs.
const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

export async function dispatchSignals(env: Env): Promise<void> {
  const db = dbConfig(env);
  const unsent = await getUnsentSignals(db);
  if (unsent.length === 0) return;

  // Effet Sniper (Bloc 2.2) : Pro (et essai gratuit, déjà instantané avant ce
  // bloc) reçoivent les signaux en premier ; Standard/Découverte suivent 15
  // minutes plus tard via cron/dispatchStandardTier.ts.
  const activeUsers = await getActiveUsers(db);
  const activeIds = activeUsers.filter((u) => u.plan === PRO_PLAN || u.plan === TRIAL_PLAN).map((u) => u.telegram_id);

  // UX — trailing stop (préférence /prefs, opt-in) : calculé une fois pour
  // tout le lot plutôt que par signal, le sous-ensemble d'abonnés concerné
  // ne change pas pendant l'exécution de ce cron.
  const trailingEnabledIds = new Set(await filterByPrefEnabled(db, activeIds, "trailing_stop"));

  for (const signal of unsent) {
    const textDefault = buildSignalMessage(signal);
    const textWithTrailing = trailingEnabledIds.size > 0 ? buildSignalMessage(signal, { trailingEnabled: true }) : textDefault;
    const send = (id: number) => {
      const text = trailingEnabledIds.has(id) ? textWithTrailing : textDefault;
      return signal.chart_url
        ? sendPhoto(env.TELEGRAM_BOT_TOKEN, id, signal.chart_url as string, { caption: text, markdown: true })
        : sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true });
    };

    // Destinataires réellement livrés (Bloc 4) : sert au suivi post-trade
    // (cron/trackSignalOutcomes.ts) pour notifier précisément qui a reçu ce
    // signal, indépendamment des abonnés actifs au moment de sa clôture.
    const delivered: number[] = [];

    for (let i = 0; i < activeIds.length; i += BATCH_SIZE) {
      const batch = activeIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            await send(id);
            return id;
          } catch (err) {
            console.error(`[signals] Échec d'envoi à ${id}:`, err);
            return null;
          }
        })
      );
      delivered.push(...results.filter((id): id is number => id !== null));
      if (i + BATCH_SIZE < activeIds.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    await recordDeliveries(db, signal.id, delivered, "pro");
    await markSignalSent(db, signal.id);
  }
}
