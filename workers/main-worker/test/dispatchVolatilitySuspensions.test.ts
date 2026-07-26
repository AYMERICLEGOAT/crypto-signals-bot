import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchVolatilitySuspensions } from "../src/cron/dispatchVolatilitySuspensions";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
} as any;

describe("dispatchVolatilitySuspensions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("poste chaque suspension non envoyée sur le canal public et la marque envoyée", async () => {
    const posted: { chatId: number; text: string }[] = [];
    let marked = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("volatility_suspensions") && url.includes("sent_to_channel=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([
            { id: 3, pair: "SOL/USDT", atr_pct: 0.068, created_at: "2026-01-01T00:00:00Z", sent_to_channel: false },
          ]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          posted.push({ chatId: body.chat_id, text: body.text });
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("volatility_suspensions") && init?.method === "PATCH") {
          if (JSON.parse(init.body as string).sent_to_channel === true) marked = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchVolatilitySuspensions(env);

    expect(posted).toHaveLength(1);
    expect(posted[0].chatId).toBe(-100123456);
    expect(posted[0].text).toContain("Signaux suspendus");
    expect(posted[0].text).toContain("SOL/USDT");
    expect(posted[0].text).toContain("6.8%");
    expect(marked).toBe(true);
  });

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchVolatilitySuspensions({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne fait rien si aucune suspension n'est en attente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await dispatchVolatilitySuspensions(env);
  });
});
