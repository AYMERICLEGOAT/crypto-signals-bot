import { describe, it, expect, vi, afterEach } from "vitest";
import { handleTrustCommand } from "../src/bot/commands/trust";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleTrustCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("affiche le nombre réel d'abonnés payants actifs", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && url.includes("plan_started_at=not.is.null")) {
          return jsonResponse([{ telegram_id: 1 }, { telegram_id: 2 }, { telegram_id: 3 }]);
        }
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleTrustCommand(env, 42);
    expect(text).toContain("3 traders");
  });

  it("reste honnête quand il n'y a encore aucun abonné payant", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleTrustCommand(env, 42);
    expect(text).not.toContain("0 trader");
    expect(text).toContain("/trial");
  });
});
