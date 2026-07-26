import { describe, it, expect, vi, afterEach } from "vitest";
import { handlePayCommand } from "../src/bot/commands/pay";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handlePayCommand — Bloc 15.2 (lien litecoin: cliquable)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ajoute un lien litecoin: avec adresse et montant préremplis pour un paiement LTC en attente", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("pending_payments")) {
          return jsonResponse([{ method: "LTC", plan: 1, pay_address: "LTestAddress123", amount_expected: 0.5 }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePayCommand(env, 1);
    expect(sentText).toContain("litecoin:LTestAddress123?amount=0.5");
  });

  it("n'ajoute pas de lien litecoin: pour un paiement USDT en attente", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("pending_payments")) {
          return jsonResponse([{ method: "USDT", plan: 1, pay_address: "0xabc", amount_expected: 19 }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePayCommand(env, 1);
    expect(sentText).not.toContain("litecoin:");
  });
});
