import { describe, it, expect, vi, afterEach } from "vitest";
import { isRateLimited } from "../src/db/rateLimit";
import { handleAdminActivateCommand } from "../src/bot/commands/adminActivate";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const db = { url: "https://fake-supabase.test", key: "k" };

describe("isRateLimited", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("délègue une décision atomique à PostgreSQL", async () => {
    let body: any = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain("/rpc/consume_command_rate_limit");
      body = JSON.parse(init!.body as string);
      return jsonResponse([{ allowed: true }]);
    }));

    expect(await isRateLimited(db, 42)).toBe(false);
    expect(body).toMatchObject({ p_telegram_id: 42, p_window_ms: 60_000, p_max_commands: 10 });
  });

  it("bloque lorsque la fonction atomique refuse la commande", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ allowed: false }])));
    expect(await isRateLimited(db, 42)).toBe(true);
  });
});

describe("handleAdminActivateCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuse l'accès à un utilisateur non-admin, sans toucher la base", async () => {
    let sentText = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        sentText = JSON.parse(init!.body as string).text;
        return jsonResponse({ ok: true, result: {} });
      }
      throw new Error(`Unexpected call: ${url}`);
    }));
    const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleAdminActivateCommand(env, 123, "555 2");
    expect(sentText).toContain("réservée");
  });

  it("active le plan demandé et journalise l'action admin", async () => {
    let activation: any = null;
    let action: any = null;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("users") && (!init || init.method === undefined)) return jsonResponse([]);
      if (url.includes("users") && init?.method === "POST") return jsonResponse([{ telegram_id: 555 }]);
      if (url.includes("users") && init?.method === "PATCH") { activation = JSON.parse(init.body as string); return jsonResponse([]); }
      if (url.includes("admin_actions") && init?.method === "POST") { action = JSON.parse(init.body as string); return jsonResponse([action]); }
      if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
      throw new Error(`Unexpected call: ${url}`);
    }));
    const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleAdminActivateCommand(env, 999, "555 2");
    expect(activation.plan).toBe(2);
    expect(action).toMatchObject({ admin_telegram_id: 999, target_telegram_id: 555 });
  });
});
