import { describe, it, expect, vi, afterEach } from "vitest";
import { handleCheckPaymentCommand } from "../src/bot/commands/checkPayment";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

async function run(latestPayment: unknown): Promise<string> {
  let sentText = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("pending_payments")) return jsonResponse(latestPayment ? [latestPayment] : []);
      if (url.includes("api.telegram.org")) {
        sentText = JSON.parse(init!.body as string).text;
        return jsonResponse({ ok: true, result: {} });
      }
      throw new Error(`URL inattendue: ${url}`);
    })
  );
  await handleCheckPaymentCommand(env, 1);
  return sentText;
}

describe("handleCheckPaymentCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('dit "aucun paiement" si rien n\'a jamais été tenté', async () => {
    const text = await run(null);
    expect(text).toContain("Aucun paiement en attente");
  });

  it("affiche l'adresse et le montant pour un paiement pending", async () => {
    const text = await run({ method: "USDT", plan: 1, pay_address: "0xabc", amount_expected: 19, status: "pending" });
    expect(text).toContain("en attente");
    expect(text).toContain("0xabc");
    expect(text).toContain("19");
    expect(text).not.toContain("0/1"); // jamais de nombre de confirmations inventé
  });

  it("confirme l'abonnement actif pour un paiement confirmé", async () => {
    const text = await run({ method: "LTC", plan: 2, pay_address: "L123", amount_expected: 0.5, status: "confirmed" });
    expect(text).toContain("confirmé");
    expect(text).toContain("actif");
  });

  it("propose de relancer pour un paiement expiré", async () => {
    const text = await run({ method: "XMR", plan: 3, pay_address: "4abc", amount_expected: 0.1, status: "expired" });
    expect(text).toContain("expiré");
    // Le rebond est un BOUTON désormais, plus un nom de commande à recopier.
    // On vérifie surtout ce qui manquait : que quelqu'un ayant réellement
    // envoyé des fonds sache qu'ils ne sont pas perdus.
    expect(text).toMatch(/pas perdus/i);
  });
});
