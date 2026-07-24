import { describe, it, expect, vi, afterEach } from "vitest";
import { sendReengagementOffers } from "../src/cron/reengagementOffer";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("sendReengagementOffers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie le code RELANCE20 aux utilisateurs expirés depuis 3+ jours et marque l'envoi", async () => {
    let sentText = "";
    let marked = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("reengagement_sent=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 55, plan: 1, expiration: "2020-01-01T00:00:00Z", reengagement_sent: false }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.reengagement_sent === true) marked = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await sendReengagementOffers(env);
    expect(sentText).toContain("RELANCE20");
    expect(marked).toBe(true);
  });

  it("ne fait rien si personne n'est éligible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await sendReengagementOffers(env);
  });
});
