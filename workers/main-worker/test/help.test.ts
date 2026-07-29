import { describe, it, expect, vi, afterEach } from "vitest";
import { handleHelpCommand } from "../src/bot/commands/help";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleHelpCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("liste les commandes utilisateur principales", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`Ne devrait interroger aucune donnée: ${url}`);
      })
    );

    await handleHelpCommand(env, 1);

    for (const cmd of ["/subscribe", "/trial", "/status", "/pay", "/code", "/cancel", "/demo", "/history", "/referral", "/trust", "/delete\\_my\\_data", "/help"]) {
      expect(text).toContain(cmd);
    }
  });

  it("n'a pas d'entité Markdown (legacy) non appariée -- un `_`/`*` non échappé et en nombre impair casse tout le sendMessage avec 'can't parse entities' (bug vécu le 29/07)", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`Ne devrait interroger aucune donnée: ${url}`);
      })
    );

    await handleHelpCommand(env, 1);

    const unescaped = text.replace(/\\[_*`[]/g, "");
    for (const marker of ["*", "_"]) {
      const count = unescaped.split(marker).length - 1;
      expect(count % 2).toBe(0);
    }
  });
});
