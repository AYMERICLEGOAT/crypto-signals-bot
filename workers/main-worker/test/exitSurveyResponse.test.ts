import { describe, it, expect, vi, afterEach } from "vitest";
import { handleExitSurveyResponse } from "../src/bot/commands/exitSurveyResponse";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleExitSurveyResponse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enregistre la raison choisie et remercie l'utilisateur", async () => {
    let inserted: any = null;
    let thanked = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("exit_surveys") && init?.method === "POST") {
          inserted = JSON.parse(init.body as string);
          return jsonResponse([{}]);
        }
        if (url.includes("api.telegram.org")) {
          thanked = true;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleExitSurveyResponse(env, 42, "exit_survey:price");
    expect(inserted).toEqual({ telegram_id: 42, reason: "price" });
    expect(thanked).toBe(true);
  });
});
