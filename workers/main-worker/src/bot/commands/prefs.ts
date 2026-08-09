import { Env, dbConfig } from "../../env";
import { sendMessage, InlineKeyboard } from "../../telegram";
import { getUserPrefs, setUserPref, UserPrefsRow } from "../../db/userPrefs";

// Alertes Momentum/Posts éducatifs/Récap hebdo sont désormais diffusés
// uniquement sur le canal public (plus de DM, voir dispatchMomentumAlerts.ts
// et consorts) : les proposer ici comme des préférences activables n'aurait
// plus aucun effet et induirait l'utilisateur en erreur.
const LABELS: Record<"trailing_stop", string> = {
  trailing_stop: "Trailing stop (suivi de stop)",
};

function buildKeyboard(prefs: UserPrefsRow): InlineKeyboard {
  return (Object.keys(LABELS) as Array<keyof typeof LABELS>).map((key) => [
    {
      text: `${prefs[key] ? "✅" : "⬜"} ${LABELS[key]}`,
      callback_data: `prefs:${key}:${prefs[key] ? "off" : "on"}`,
    },
  ]);
}

/**
 * /prefs — préférences de notification. Les signaux directionnels restent
 * toujours activés : ils SONT le produit.
 *
 * « Haute confiance » désignait l'ancien moteur EMA/RSI, désactivé le
 * 03/08/2026 après avoir été mesuré PERDANT. Le nom survivait ici et promettait
 * à l'abonné des signaux issus de la stratégie que le projet a lui-même
 * désavouée. « Directionnels » décrit ce qu'il reçoit réellement : force
 * relative, cassure de canal, expansion de volatilité et momentum 4H.
 */
export async function handlePrefsCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const prefs = await getUserPrefs(db, telegramId);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🔔 *Tes préférences de notification*\n\n" +
      "🟢 Signaux directionnels — toujours activés (ils sont le produit)\n" +
      "🔁 Carrys de financement — toujours activés\n\n" +
      "🔒 *Trailing stop* : une fois activé, tu reçois un message dès que le prix progresse en ta faveur, te suggérant de remonter (ou baisser) ton stop pour sécuriser une partie du gain. Purement indicatif — n'affecte jamais le stop loss officiel du signal.\n\n" +
      "Appuie pour activer/désactiver :",
    { markdown: true, keyboard: buildKeyboard(prefs) }
  );
}

/** data au format "prefs:<cle>:on" ou "prefs:<cle>:off". */
export async function handlePrefsToggle(env: Env, telegramId: number, data: string): Promise<void> {
  const [, key, action] = data.split(":");
  if (key !== "trailing_stop") return;

  const db = dbConfig(env);
  await setUserPref(db, telegramId, key, action === "on");
  const prefs = await getUserPrefs(db, telegramId);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `${LABELS[key]} : ${prefs[key] ? "activé ✅" : "désactivé ⬜"}`,
    { keyboard: buildKeyboard(prefs) }
  );
}
