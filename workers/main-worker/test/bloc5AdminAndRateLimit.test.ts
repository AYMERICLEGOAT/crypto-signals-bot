import { describe, it, expect, vi, afterEach } from "vitest";
import { isRateLimited } from "../src/db/rateLimit";
import { handleAdminActivateCommand } from "../src/bot/commands/adminActivate";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const db = { url: "https://fake-supabase.test", key: "k" };

describe("isRateLimited", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("autorise et initialise la fenêtre pour un premier appel", async () => {
    let upserted: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("command_rate_limit") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("command_rate_limit") && init?.method === "POST") {
          upserted = JSON.parse(init.body as string);
          return jsonResponse([upserted]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const limited = await isRateLimited(db, 42);
    expect(limited).toBe(false);
    expect(upserted).toMatchObject({ telegram_id: 42, count: 1 });
  });

  it("autorise et incrémente si sous la limite dans la fenêtre en cours", async () => {
    let upserted: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("command_rate_limit") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, window_start: new Date().toISOString(), count: 3 }]);
        }
        if (url.includes("command_rate_limit") && init?.method === "POST") {
          upserted = JSON.parse(init.body as string);
          return jsonResponse([upserted]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const limited = await isRateLimited(db, 42);
    expect(limited).toBe(false);
    expect(upserted.count).toBe(4);
  });

  it("bloque au-delà de la limite dans la fenêtre en cours, sans réécrire le compteur", async () => {
    let postCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("command_rate_limit") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, window_start: new Date().toISOString(), count: 10 }]);
        }
        if (url.includes("command_rate_limit") && init?.method === "POST") {
          postCalled = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const limited = await isRateLimited(db, 42);
    expect(limited).toBe(true);
    expect(postCalled).toBe(false);
  });

  it("réinitialise silencieusement une fenêtre expirée", async () => {
    let upserted: any = null;
    const oldWindowStart = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // il y a 5 min
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("command_rate_limit") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, window_start: oldWindowStart, count: 10 }]);
        }
        if (url.includes("command_rate_limit") && init?.method === "POST") {
          upserted = JSON.parse(init.body as string);
          return jsonResponse([upserted]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const limited = await isRateLimited(db, 42);
    expect(limited).toBe(false);
    expect(upserted.count).toBe(1);
  });
});

describe("handleAdminActivateCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuse l'accès à un utilisateur non-admin, sans toucher la base", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`Ne devrait interroger aucune donnée: ${url}`);
      })
    );

    const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleAdminActivateCommand(env, 123, "555 2");
    expect(sentText).toContain("réservée");
  });

  it("renvoie l'usage si les arguments sont invalides", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`Ne devrait interroger aucune donnée: ${url}`);
      })
    );

    const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleAdminActivateCommand(env, 999, "555 9"); // plan 9 invalide
    expect(sentText).toContain("Usage");
  });

  it("active un plan payant avec la durée par défaut, journalise et notifie admin + utilisateur", async () => {
    let activatePatch: any = null;
    let loggedAction: any = null;
    const sentTexts: Record<number, string> = {};

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && (!init || init.method === undefined)) return jsonResponse([]); // getOrCreateUser: pas trouvé
        if (url.includes("users") && init?.method === "POST") return jsonResponse([{ telegram_id: 555 }]); // création
        if (url.includes("users") && init?.method === "PATCH") {
          activatePatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("admin_actions") && init?.method === "POST") {
          loggedAction = JSON.parse(init.body as string);
          return jsonResponse([loggedAction]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          sentTexts[body.chat_id] = body.text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleAdminActivateCommand(env, 999, "555 2"); // Pro, durée par défaut = 30j

    expect(activatePatch.plan).toBe(2);
    expect(loggedAction).toMatchObject({ admin_telegram_id: 999, action: "admin_activate", target_telegram_id: 555 });
    expect(sentTexts[999]).toContain("Pro");
    expect(sentTexts[555]).toContain("activé manuellement");
  });

  it("accepte une durée personnalisée en jours", async () => {
    let activatePatch: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && (!init || init.method === undefined)) return jsonResponse([{ telegram_id: 555 }]);
        if (url.includes("users") && init?.method === "PATCH") {
          activatePatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("admin_actions") && init?.method === "POST") return jsonResponse([{}]);
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const env = { TELEGRAM_BOT_TOKEN: "t", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleAdminActivateCommand(env, 999, "555 3 5"); // Découverte, 5 jours (au lieu des 14 par défaut)

    const expiration = new Date(activatePatch.expiration);
    const expectedMs = Date.now() + 5 * 24 * 60 * 60 * 1000;
    expect(Math.abs(expiration.getTime() - expectedMs)).toBeLessThan(5000);
  });
});
