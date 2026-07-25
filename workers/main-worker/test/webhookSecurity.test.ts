import { describe, it, expect } from "vitest";
import { createExecutionContext, waitOnExecutionContext, env } from "cloudflare:test";
import worker from "../src/index";

describe("index.ts fetch() — sécurité et routage de base", () => {
  it("rejette /telegram-webhook sans le bon secret (401)", async () => {
    const request = new Request("https://example.com/telegram-webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "definitely-not-the-real-secret" },
      body: JSON.stringify({ update_id: 1 }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
  });

  it("rejette /telegram-webhook sans en-tête de secret du tout (401)", async () => {
    const request = new Request("https://example.com/telegram-webhook", {
      method: "POST",
      body: JSON.stringify({ update_id: 1 }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(401);
  });

  it("accepte /telegram-webhook avec le bon secret (200)", async () => {
    const request = new Request("https://example.com/telegram-webhook", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ update_id: 1 }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
  });

  it("retourne 404 pour une route inconnue", async () => {
    const request = new Request("https://example.com/route-inexistante");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});
