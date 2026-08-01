import { Env } from "../env";
import { sendMessage } from "../telegram";

/**
 * Renforcement de la découverte du bot (refonte UX du 01/08/2026) : rappel
 * régulier dans le canal public pour les membres qui le suivent sans avoir
 * encore démarré le bot en privé. Cron dédié toutes les 3 heures (voir le
 * troisième déclencheur dans wrangler.toml et index.ts) -- la fréquence
 * d'envoi est directement fixée par ce cron, pas besoin d'un gate "déjà
 * envoyé aujourd'hui" comme pour le contenu quotidien.
 */
export async function dispatchChannelCta(env: Env): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID || !env.TELEGRAM_BOT_USERNAME) return;

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    Number(env.TELEGRAM_CHANNEL_ID),
    `🔒 Pour recevoir ces signaux en temps réel avec TP/SL et sécurisation automatique : @${env.TELEGRAM_BOT_USERNAME}`
  );
}
