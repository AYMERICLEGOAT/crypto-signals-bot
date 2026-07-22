/**
 * À exécuter une fois après le déploiement (ou après un changement d'URL) :
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WORKER_URL=https://xxx.workers.dev npm run set-webhook
 *
 * Le secret doit être EXACTEMENT celui posé via `wrangler secret put TELEGRAM_WEBHOOK_SECRET`.
 */

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
}

async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const workerUrl = process.env.WORKER_URL;

  if (!token || !secret || !workerUrl) {
    console.error("Variables manquantes. Utilisation :");
    console.error(
      "  TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... WORKER_URL=https://xxx.workers.dev npm run set-webhook"
    );
    process.exit(1);
  }

  const webhookUrl = `${workerUrl.replace(/\/$/, "")}/telegram-webhook`;
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
  });
  const json = (await res.json()) as TelegramApiResponse;
  console.log(json);

  if (!json.ok) {
    console.error("Échec de la configuration du webhook.");
    process.exit(1);
  }
  console.log(`Webhook configuré sur ${webhookUrl}`);
}

main();
