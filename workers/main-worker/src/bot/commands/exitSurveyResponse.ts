import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { recordExitSurveyResponse, ExitSurveyReason } from "../../db/exitSurveys";

/** data au format "exit_survey:frequency" | "exit_survey:performance" | "exit_survey:price" | "exit_survey:other". */
export async function handleExitSurveyResponse(env: Env, telegramId: number, data: string): Promise<void> {
  const reason = data.split(":")[1] as ExitSurveyReason;
  await recordExitSurveyResponse(dbConfig(env), telegramId, reason);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Merci pour ton retour, c'est noté. 🙏");
}
