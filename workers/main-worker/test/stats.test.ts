import { describe, it, expect, vi, afterEach } from "vitest";
import { getAdminStats } from "../src/db/adminStats";
import { handleStatsCommand } from "../src/bot/commands/stats";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const db = { url: "https://fake-supabase.test", key: "k" };

describe("getAdminStats", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calcule le taux de conversion à partir des essais et des paiements reels (plan_started_at)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("trial_used=eq.true")) return jsonResponse([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]); // 4 essais
        if (url.includes("plan_started_at=not.is.null") && url.includes("expiration=gt.")) return jsonResponse([{ id: 1 }]); // 1 actif payant
        if (url.includes("plan_started_at=not.is.null")) return jsonResponse([{ id: 1 }, { id: 2 }]); // 2 ont payé au moins une fois
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const stats = await getAdminStats(db);
    expect(stats.trials).toBe(4);
    expect(stats.everPaid).toBe(2);
    expect(stats.activePaying).toBe(1);
    expect(stats.conversionRatePct).toBe(50);
  });

  it("retourne 0% de conversion si aucun essai n'a jamais été pris", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    const stats = await getAdminStats(db);
    expect(stats.conversionRatePct).toBe(0);
  });
});

describe("handleStatsCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuse l'accès à un utilisateur non-admin", async () => {
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

    const env = { TELEGRAM_BOT_TOKEN: "fake-token", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleStatsCommand(env, 123);
    expect(sentText).toContain("réservée");
  });

  it("affiche le dashboard pour l'admin", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("trial_used=eq.true")) return jsonResponse([{ id: 1 }]);
        if (url.includes("plan_started_at=not.is.null") && url.includes("expiration=gt.")) return jsonResponse([]);
        if (url.includes("plan_started_at=not.is.null")) return jsonResponse([]);
        if (url.includes("strategy_params")) return jsonResponse([{ win_rate: 0.7931, trade_count: 29 }]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const env = { TELEGRAM_BOT_TOKEN: "fake-token", ADMIN_TELEGRAM_ID: "999", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;
    await handleStatsCommand(env, 999);
    expect(sentText).toContain("Dashboard");
    expect(sentText).toContain("79.3%");
  });
});
