import { describe, it, expect, vi, afterEach } from "vitest";
import { handleCancelCommand } from "../src/bot/commands/cancel";
import { handleDeleteMyDataCommand } from "../src/bot/commands/deleteMyData";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;
const user = { telegram_id: 1, wallet_address: "0xabc", plan: 1, expiration: null, cancelled: false, deleted: false };

describe("cancel and deletion", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires explicit cancellation confirmation", async () => {
    let text = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("users") && (!init || init.method === undefined)) return jsonResponse([user]);
      if (url.includes("api.telegram.org")) { text = JSON.parse(init!.body as string).text; return jsonResponse({ ok: true, result: {} }); }
      throw new Error(`Unexpected call: ${url}`);
    }));
    await handleCancelCommand(env, 1, "");
    expect(text).toContain("/cancel confirm");
    expect(text).not.toContain("RELANCE50");
  });

  it("cancels without sending a survey or promotion", async () => {
    const sent: string[] = [];
    let patch: any = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("users") && (!init || init.method === undefined)) return jsonResponse([user]);
      if (url.includes("users") && init?.method === "PATCH") { patch = JSON.parse(init.body as string); return jsonResponse([]); }
      if (url.includes("api.telegram.org")) { sent.push(JSON.parse(init!.body as string).text); return jsonResponse({ ok: true, result: {} }); }
      throw new Error(`Unexpected call: ${url}`);
    }));
    await handleCancelCommand(env, 1, "confirm");
    expect(patch).toEqual({ cancelled: true });
    expect(sent).toHaveLength(1);
  });

  it("deletes auxiliary personal records before retaining the anti-abuse wallet", async () => {
    const deleted: string[] = [];
    let userPatch: any = null;
    let litecoinPoolPatch: any = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") { deleted.push(url); return jsonResponse([]); }
      if (url.includes("litecoin_address_pool") && init?.method === "PATCH") { litecoinPoolPatch = JSON.parse(init.body as string); return jsonResponse([]); }
      if (url.includes("users") && (!init || init.method === undefined)) return jsonResponse([user]);
      if (url.includes("users") && init?.method === "PATCH") { userPatch = JSON.parse(init.body as string); return jsonResponse([]); }
      if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
      throw new Error(`Unexpected call: ${url}`);
    }));
    await handleDeleteMyDataCommand(env, 1, "confirm");
    // 10 tables purgées (audit du 31/07 : +lucky_vip_draws par rapport à avant) + le nettoyage litecoin_address_pool testé séparément ci-dessous.
    expect(deleted).toHaveLength(10);
    expect(deleted.some((url) => url.includes("lucky_vip_draws"))).toBe(true);
    expect(litecoinPoolPatch).toEqual({ reserved_for_telegram_id: null });
    expect(userPatch).toMatchObject({ deleted: true, expiration: null });
    expect(userPatch.wallet_address).toBeUndefined();
  });
});
