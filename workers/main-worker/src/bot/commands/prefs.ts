import { Env, dbConfig } from "../../env";
import { sendMessage, InlineKeyboard } from "../../telegram";
import { getUserPrefs, setUserPref, UserPrefsRow } from "../../db/userPrefs";

const LABELS: Record<"momentum_alerts" | "educational_posts" | "weekly_recap" | "trailing_stop", string> = {
  momentum_alerts: "Alertes Momentum",
  educational_posts: "Posts éducatifs",
  weekly_recap: "Récap hebdomadaire",
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

/** /prefs — Bloc 19 : préférences de notification (les signaux Haute confiance restent obligatoires). */
export async function handlePrefsCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const prefs = await getUserPrefs(db, telegramId);

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🔔 *Tes préférences de notification*\n\n" +
      "🟢 Signaux Haute confiance — toujours activés (inclus dans ton abonnement)\n\n" +
      "Les 3 premières options sont en plus des signaux, diffusés aussi sur le canal public.\n\n" +
      "🔒 *Trailing stop* : une fois activé, tu reçois un message dès que le prix progresse en ta faveur, te suggérant de remonter (ou baisser) ton stop pour sécuriser une partie du gain. Purement indicatif — n'affecte jamais le stop loss officiel du signal.\n\n" +
      "Appuie pour activer/désactiver :",
    { markdown: true, keyboard: buildKeyboard(prefs) }
  );
}

/** data au format "prefs:<cle>:on" ou "prefs:<cle>:off". */
export async function handlePrefsToggle(env: Env, telegramId: number, data: string): Promise<void> {
  const [, key, action] = data.split(":");
  if (key !== "momentum_alerts" && key !== "educational_posts" && key !== "weekly_recap" && key !== "trailing_stop") return;

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
