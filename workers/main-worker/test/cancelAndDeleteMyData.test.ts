import { describe, it, expect, vi, afterEach } from "vitest";
import { handleCancelCommand } from "../src/bot/commands/cancel";
import { handleDeleteMyDataCommand } from "../src/bot/commands/deleteMyData";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    telegram_id: 1,
    wallet_address: null,
    plan: 1,
    expiration: null,
    trial_used: false,
    created_at: "2026-01-01T00:00:00Z",
    referred_by: null,
    referral_rewarded: false,
    plan_started_at: null,
    cancelled: false,
    deleted: false,
    ...overrides,
  };
}

describe("handleCancelCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sans argument : montre l'offre de rétention (RELANCE50) sans rien modifier", async () => {
    let sentText = "";
    let patched = false;
    const futureExpiration = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("users") && isGet) return jsonResponse([makeUser({ expiration: futureExpiration })]);
        if (url.includes("users") && init?.method === "PATCH") {
          patched = true;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleCancelCommand(env, 1, "");

    expect(sentText).toContain("RELANCE50");
    expect(sentText).toContain("/cancel confirm");
    expect(patched).toBe(false);
  });

  it("/cancel confirm : marque cancelled=true, confirme, et envoie l'enquête de départ (Bloc 14.2)", async () => {
    let cancelledPatch: any = null;
    const sentTexts: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("users") && isGet) return jsonResponse([makeUser()]);
        if (url.includes("users") && init?.method === "PATCH") {
          cancelledPatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          sentTexts.push(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleCancelCommand(env, 1, "confirm");

    expect(cancelledPatch).toEqual({ cancelled: true });
    expect(sentTexts[0]).toContain("on ne te relancera plus");
    expect(sentTexts[1]).toContain("déçu");
  });

  it("ne fait rien de plus si déjà annulé", async () => {
    let sentText = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const isGet = !init || init.method === undefined;
      if (url.includes("users") && isGet) return jsonResponse([makeUser({ cancelled: true })]);
      if (url.includes("api.telegram.org")) {
        sentText = JSON.parse(init!.body as string).text;
        return jsonResponse({ ok: true, result: {} });
      }
      throw new Error(`Ne devrait pas être appelé: ${url} ${init?.method}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await handleCancelCommand(env, 1, "");
    expect(sentText).toContain("déjà fait");
  });
});

describe("handleDeleteMyDataCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sans argument : avertit sans rien supprimer", async () => {
    let sentText = "";
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        sentText = JSON.parse(init!.body as string).text;
        return jsonResponse({ ok: true, result: {} });
      }
      throw new Error(`Ne devrait interroger aucune donnée: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await handleDeleteMyDataCommand(env, 1, "");
    expect(sentText).toContain("irréversible");
    expect(sentText).toContain("wallet");
  });

  it("confirm : anonymise les champs personnels, garde le wallet, révoque l'accès", async () => {
    let erasePatch: any = null;
    let sentText = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("users") && isGet) return jsonResponse([makeUser({ wallet_address: "0xabc" })]);
        if (url.includes("users") && init?.method === "PATCH") {
          erasePatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleDeleteMyDataCommand(env, 1, "confirm");

    expect(erasePatch).toEqual({
      referred_by: null,
      pending_promo_code: null,
      survey_response: null,
      expiration: null,
      deleted: true,
    });
    expect(erasePatch.wallet_address).toBeUndefined(); // jamais touchée (anti-abus)
    expect(sentText).toContain("supprimées");
  });
});
