import { describe, it, expect, vi, afterEach } from "vitest";
import { checkExpirationReminders } from "../src/cron/expirationReminders";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

function makeUser(telegramId: number) {
  return {
    telegram_id: telegramId,
    plan: 1,
    expiration: new Date().toISOString(),
    reminder_48h_sent: false,
    reminder_24h_sent: false,
  };
}

describe("checkExpirationReminders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie la relance 48h et 24h aux utilisateurs concernés, avec le récap de performance", async () => {
    const sentMessages: string[] = [];
    const markedFlags: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("strategy_params")) {
          return jsonResponse([{ win_rate: 0.7931, trade_count: 29 }]);
        }
        if (url.includes("reminder_48h_sent") && url.includes("and=")) {
          if (!init || init.method === undefined) return jsonResponse([makeUser(1)]);
        }
        if (url.includes("reminder_24h_sent") && url.includes("and=")) {
          if (!init || init.method === undefined) return jsonResponse([makeUser(2)]);
        }
        if (url.includes("api.telegram.org")) {
          sentMessages.push(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.reminder_48h_sent) markedFlags.push("48h");
          if (body.reminder_24h_sent) markedFlags.push("24h");
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await checkExpirationReminders(env);

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]).toContain("48h");
    expect(sentMessages[0]).toContain("79.3%");
    expect(sentMessages[1]).toContain("24h");
    expect(markedFlags).toEqual(["48h", "24h"]);
  });

  it("envoie quand même la relance si la lecture du backtest échoue (perf jamais bloquante)", async () => {
    let sent = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("strategy_params")) throw new Error("Supabase indisponible");
        if (url.includes("reminder_48h_sent") && (!init || init.method === undefined)) return jsonResponse([makeUser(1)]);
        if (url.includes("reminder_24h_sent") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sent = true;
          return jsonResponse({ ok: true, result: {} });
        }
        if (init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await checkExpirationReminders(env);
    expect(sent).toBe(true);
  });

  it("ne fait rien si personne n'arrive à échéance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("strategy_params")) return jsonResponse([]);
        if (url.includes("reminder_48h_sent") || url.includes("reminder_24h_sent")) return jsonResponse([]);
        throw new Error(`Ne devrait pas être appelé: ${url}`);
      })
    );

    await checkExpirationReminders(env);
  });
});
