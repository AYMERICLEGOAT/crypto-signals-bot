import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { setSurveyResponse } from "../../db/users";

/** data au format "survey:up" ou "survey:down". */
export async function handleSurveyResponse(env: Env, telegramId: number, data: string): Promise<void> {
  const response = data.split(":")[1] as "up" | "down";
  const db = dbConfig(env);
  await setSurveyResponse(db, telegramId, response);

  const thanks = response === "up" ? "Merci pour ton retour ! 🙌" : "Merci pour ton retour, on va essayer de faire mieux. 🙏";
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, thanks);
}
