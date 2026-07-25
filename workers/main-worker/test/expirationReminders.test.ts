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
    reminder_2h_sent: false,
  };
}

describe("checkExpirationReminders", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie les relances 48h, 24h et 2h aux utilisateurs concernés, avec la phrase honnête (jamais de % dynamique par défaut)", async () => {
    const sentMessages: string[] = [];
    const markedFlags: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("reminder_48h_sent") && url.includes("and=")) {
          if (!init || init.method === undefined) return jsonResponse([makeUser(1)]);
        }
        if (url.includes("reminder_24h_sent") && url.includes("and=")) {
          if (!init || init.method === undefined) return jsonResponse([makeUser(2)]);
        }
        if (url.includes("reminder_2h_sent") && url.includes("and=")) {
          if (!init || init.method === undefined) return jsonResponse([makeUser(3)]);
        }
        if (url.includes("api.telegram.org")) {
          sentMessages.push(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.reminder_48h_sent) markedFlags.push("48h");
          if (body.reminder_24h_sent) markedFlags.push("24h");
          if (body.reminder_2h_sent) markedFlags.push("2h");
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await checkExpirationReminders(env);

    expect(sentMessages).toHaveLength(3);
    expect(sentMessages[0]).toContain("48h");
    expect(sentMessages[0]).toContain("Stratégie backtestée sur 6 mois");
    expect(sentMessages[0]).not.toMatch(/\d+(\.\d+)?%/); // jamais de pourcentage dynamique tant que DISPLAY_WINRATE n'est pas activé
    expect(sentMessages[1]).toContain("24h");
    expect(sentMessages[2]).toContain("2h");
    expect(sentMessages[2]).toContain("Dernière chance");
    expect(markedFlags).toEqual(["48h", "24h", "2h"]);
  });

  it("affiche un pourcentage réel uniquement si DISPLAY_WINRATE=true", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("strategy_params")) return jsonResponse([{ win_rate: 0.6, trade_count: 40 }]);
        if (url.includes("reminder_48h_sent") && (!init || init.method === undefined)) return jsonResponse([makeUser(1)]);
        if (url.includes("reminder_24h_sent") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("reminder_2h_sent") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await checkExpirationReminders({ ...env, DISPLAY_WINRATE: "true" });
    expect(sentText).toContain("60.0%");
  });

  it("envoie quand même la relance si la lecture du backtest échoue (perf jamais bloquante)", async () => {
    let sent = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("strategy_params")) throw new Error("Supabase indisponible");
        if (url.includes("reminder_48h_sent") && (!init || init.method === undefined)) return jsonResponse([makeUser(1)]);
        if (url.includes("reminder_24h_sent") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("reminder_2h_sent") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sent = true;
          return jsonResponse({ ok: true, result: {} });
        }
        if (init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await checkExpirationReminders({ ...env, DISPLAY_WINRATE: "true" });
    expect(sent).toBe(true);
  });

  it("ne fait rien si personne n'arrive à échéance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("reminder_48h_sent") || url.includes("reminder_24h_sent") || url.includes("reminder_2h_sent")) {
          return jsonResponse([]);
        }
        throw new Error(`Ne devrait pas être appelé: ${url}`);
      })
    );

    await checkExpirationReminders(env);
  });
});
