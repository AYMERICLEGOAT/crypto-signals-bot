/**
 * Filet de rattrapage : tout abonné payant qui n'a pas reçu un signal le reçoit
 * ici.
 *
 * CE MODULE NE DIFFÈRE PLUS RIEN (08/08/2026). Il retardait les paliers les
 * moins chers de quinze minutes, pour que le plan Pro ait « la rapidité » comme
 * valeur différenciante. Sur une position qui se ferme au bout de trois à
 * vingt-et-un jours, quinze minutes ne valent rien : cette différence était
 * vendue sans exister. Les paliers se distinguent désormais par leur DURÉE
 * (voir payments/plans.ts), et tous les abonnés payants reçoivent au même
 * moment.
 *
 * Le module reste, et il sert : il rattrape tout abonné que dispatchSignals
 * aurait manqué — plan changé entre deux cycles, envoi Telegram échoué,
 * utilisateur activé entre-temps. C'est un filet, plus un palier.
 *
 * Le canal public gratuit (cron/dispatchPublicChannel.ts) reste diffusé plus
 * tard, et surtout sans les niveaux : c'est là qu'est la vraie différence.
 */

import { Env, dbConfig } from "../env";
import { getSignalsDueForStandardTier, markSentToStandard } from "../db/signals";
import { getActiveUsers } from "../db/users";
import { filterByPrefEnabled } from "../db/userPrefs";
import { recordDeliveries, getDeliveryRecipients } from "../db/signalDeliveries";
import { sendMessage, sendPhoto } from "../telegram";
import { buildSignalMessage } from "../signalFormat";

// Zéro : plus aucun palier payant n'est retardé. La constante reste pour que
// getSignalsDueForStandardTier garde sa signature, et pour que ce choix soit
// visible au lieu d'être un appel sans argument.
export const SNIPER_DELAY_MINUTES = 0;

const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

export async function dispatchStandardTier(env: Env): Promise<void> {
  const db = dbConfig(env);
  const due = await getSignalsDueForStandardTier(db, SNIPER_DELAY_MINUTES);
  if (due.length === 0) return;

  const activeUsers = await getActiveUsers(db);

  for (const signal of due) {
    // Cible "pas encore livré CE signal" plutôt qu'un filtre par plan figé :
    // un abonné qui change de plan (ex. Standard -> Pro) entre l'envoi
    // immédiat (dispatchSignals.ts) et ce lot différé ne doit ni être oublié
    // ni recevoir le signal deux fois.
    const alreadyDelivered = new Set(await getDeliveryRecipients(db, signal.id));
    const targetIds = activeUsers.filter((u) => !alreadyDelivered.has(u.telegram_id)).map((u) => u.telegram_id);
    if (targetIds.length === 0) {
      await markSentToStandard(db, signal.id);
      continue;
    }
    const trailingEnabledIds = new Set(await filterByPrefEnabled(db, targetIds, "trailing_stop"));

    const textDefault = buildSignalMessage(signal);
    const textWithTrailing = trailingEnabledIds.size > 0 ? buildSignalMessage(signal, { trailingEnabled: true }) : textDefault;
    const send = (id: number) => {
      const text = trailingEnabledIds.has(id) ? textWithTrailing : textDefault;
      return signal.chart_url
        ? sendPhoto(env.TELEGRAM_BOT_TOKEN, id, signal.chart_url as string, { caption: text, markdown: true })
        : sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true });
    };

    const delivered: number[] = [];

    for (let i = 0; i < targetIds.length; i += BATCH_SIZE) {
      const batch = targetIds.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (id) => {
          try {
            await send(id);
            return id;
          } catch (err) {
            console.error(`[standard-tier] Échec d'envoi à ${id}:`, err);
            return null;
          }
        })
      );
      delivered.push(...results.filter((id): id is number => id !== null));
      if (i + BATCH_SIZE < targetIds.length) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    await recordDeliveries(db, signal.id, delivered, "standard");
    await markSentToStandard(db, signal.id);
  }
}
