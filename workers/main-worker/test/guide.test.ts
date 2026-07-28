import { describe, it, expect, vi, afterEach } from "vitest";
import { handleGuideCommand } from "../src/bot/commands/guide";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleGuideCommand (Bloc 21)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("utilise le dernier signal réel comme exemple concret quand il existe", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/signals") && url.includes("order=created_at.desc")) {
          return jsonResponse([{ id: 9, pair: "ETH/USDT", type: "SELL", entry_price: 3000, stop_loss: 3060, take_profit: 2880, created_at: "2026-01-01T00:00:00Z" }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleGuideCommand(env, 1);
    expect(sentText).toContain("ETH/USDT");
    expect(sentText).toContain("3000");
    expect(sentText).toContain("Pas un conseil financier");
  });

  it("retombe sur un exemple générique si aucun signal réel n'existe encore", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/signals")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleGuideCommand(env, 1);
    expect(sentText).toContain("exemple, aucun signal réel émis");
  });
});
