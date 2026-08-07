import { describe, it, expect, vi, afterEach } from "vitest";
import { handlePurchaseConsent } from "../src/bot/commands/subscribe";
import { handlePaymentGuideCommand } from "../src/bot/commands/paymentGuide";
import { routeUpdate } from "../src/bot/router";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  ADMIN_TELEGRAM_ID: "999",
} as any;

/**
 * La table pending_payments est vide depuis le début du projet : pas une
 * seule tentative de paiement. Le tunnel se réduisait à « Choisis ton moyen
 * de paiement » face à trois cryptomonnaies (02/08/2026).
 */
describe("Tunnel de paiement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("répond aux quatre questions qui bloquent, avant le choix", async () => {
    const sent: string[] = [];
    let guideButton = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          const b = JSON.parse(init!.body as string);
          sent.push(b.text);
          if (JSON.stringify(b.reply_markup ?? "").includes("pay:guide")) guideButton = true;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await handlePurchaseConsent(env, 42, "consent:1");

    const all = sent.join("\n");
    expect(all.toLowerCase()).toContain("3 étapes");  // comment on fait
    expect(all).toContain("USDT sur Polygon");   // quoi prendre dans le doute
    // Combien de temps — mais PAR MOYEN DE PAIEMENT. « 2 à 5 minutes » était
    // annoncé pour les trois, alors que Monero exige dix confirmations et
    // demande une vingtaine de minutes. Quelqu'un qui paie en XMR et attend
    // trois fois plus longtemps que promis conclut que son paiement a échoué.
    expect(all).toContain("DÉLAI D'ACTIVATION");
    expect(all).toMatch(/Polygon\s?: moins de 5 minutes/);
    expect(all).toMatch(/Monero\s?: environ 25 minutes/);
    expect(all).toContain("Aucun prélèvement");  // à quoi on s'engage
    expect(guideButton).toBe(true);
    // Filet de rassurance : pouvoir "répondre" lève une hésitation réelle.
    expect(all).toContain("Réponds simplement à ce message");
  });

  it("le guide complet avertit du piège le plus coûteux : le mauvais réseau", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await handlePaymentGuideCommand(env, 42);

    expect(text).toContain("mauvais réseau");
    expect(text).toContain("perdus");
    expect(text.toLowerCase()).toContain("frais de retrait");
    // Annonce honnête de ce qui n'existe pas encore.
    expect(text).toContain("Carte bancaire");
  });

  it("le bouton 'pay:guide' n'est pas capté par le handler des moyens de paiement", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("consume_command_rate_limit") || url.includes("/rpc/")) {
          return jsonResponse([{ allowed: true }]);
        }
        if (url.includes("api.telegram.org") && url.includes("sendMessage")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        return jsonResponse([]);
      })
    );

    await routeUpdate(env, {
      update_id: 1,
      callback_query: { id: "x", data: "pay:guide", from: { id: 42 }, message: { message_id: 1, chat: { id: 42 } } },
    } as any);

    expect(text).toContain("GUIDE DE PAIEMENT COMPLET");
  });

  it("le guide n'utilise pas Markdown — un caractère mal échappé ferait tomber tout le message", async () => {
    let payload: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          payload = JSON.parse(init!.body as string);
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await handlePaymentGuideCommand(env, 42);
    expect(payload.parse_mode).toBeUndefined();
  });
});
