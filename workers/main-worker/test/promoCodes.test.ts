import { describe, it, expect, vi, afterEach } from "vitest";
import { getEffectivePriceUsd, consumePendingPromoCode } from "../src/payments/promoCodes";
import { handlePromoCodeCommand } from "../src/bot/commands/promoCode";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const db = { url: "https://fake-supabase.test", key: "k" };
const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;

describe("getEffectivePriceUsd", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retourne le prix de base si l'utilisateur n'a pas de code en attente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ telegram_id: 1, pending_promo_code: null }])));
    expect(await getEffectivePriceUsd(db, 1, 10)).toBe(10);
  });

  it("applique la réduction si un code actif est en attente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("telegram_id=eq.1")) return jsonResponse([{ telegram_id: 1, pending_promo_code: "RELANCE20" }]);
        if (url.includes("promo_codes")) return jsonResponse([{ code: "RELANCE20", discount_pct: 20, active: true }]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    expect(await getEffectivePriceUsd(db, 1, 10)).toBe(8);
  });

  it("retourne le prix de base si le code en attente n'est plus actif", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("telegram_id=eq.1")) return jsonResponse([{ telegram_id: 1, pending_promo_code: "OLDCODE" }]);
        if (url.includes("promo_codes")) return jsonResponse([]); // active=true ne matche rien
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    expect(await getEffectivePriceUsd(db, 1, 25)).toBe(25);
  });
});

describe("consumePendingPromoCode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enregistre la consommation et efface pending_promo_code", async () => {
    let redemptionInserted = false;
    let cleared = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("telegram_id=eq.1") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, pending_promo_code: "RELANCE20" }]);
        }
        if (url.includes("promo_code_redemptions") && init?.method === "POST") {
          redemptionInserted = true;
          return jsonResponse([{ id: 1 }]);
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.pending_promo_code === null) cleared = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await consumePendingPromoCode(db, 1);
    expect(redemptionInserted).toBe(true);
    expect(cleared).toBe(true);
  });

  it("ne fait rien si l'utilisateur n'avait pas de code en attente", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ telegram_id: 1, pending_promo_code: null }]));
    vi.stubGlobal("fetch", fetchSpy);

    await consumePendingPromoCode(db, 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("handlePromoCodeCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("active le code et confirme la réduction", async () => {
    let applied = false;
    let sentText = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("promo_codes") && url.includes("code=eq.RELANCE20")) {
          return jsonResponse([{ code: "RELANCE20", discount_pct: 20, active: true }]);
        }
        if (url.includes("promo_code_redemptions")) return jsonResponse([]);
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          applied = body.pending_promo_code === "RELANCE20";
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePromoCodeCommand(env, 1, "relance20");
    expect(applied).toBe(true);
    expect(sentText).toContain("-20%");
  });

  it("rejette un code inconnu", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("promo_codes")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePromoCodeCommand(env, 1, "BIDON");
    expect(sentText).toContain("invalide");
  });

  it("refuse un code déjà utilisé par cet utilisateur", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("promo_codes") && url.includes("code=eq.")) return jsonResponse([{ code: "RELANCE20", discount_pct: 20, active: true }]);
        if (url.includes("promo_code_redemptions")) return jsonResponse([{ id: 1, code: "RELANCE20", telegram_id: 1 }]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePromoCodeCommand(env, 1, "RELANCE20");
    expect(sentText).toContain("déjà utilisé");
  });
});
