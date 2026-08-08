import { describe, it, expect, vi, afterEach } from "vitest";
import { runDailyMaintenance } from "../src/cron/dailyMaintenance";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("runDailyMaintenance", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si l'instantané du jour existe déjà (gate quotidien)", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("daily_stats") && url.includes("stat_date=eq.")) return jsonResponse([{ stat_date: "2026-07-25" }]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await runDailyMaintenance(env);
  });

  it("calcule et archive l'instantané, purge les vieilles alertes momentum et les paiements en attente périmés", async () => {
    let insertedStats: any = null;
    let purgedMomentum = false;
    let purgedJournal = false;
    let expiredPayments = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("daily_stats") && url.includes("stat_date=eq.") && (!init || init.method === undefined)) {
          return jsonResponse([]); // pas encore calculé aujourd'hui
        }
        if (url.includes("users") && url.includes("plan=eq.0")) return jsonResponse([{ telegram_id: 1 }]); // essais actifs
        if (url.includes("users") && url.includes("plan_started_at=not.is.null")) return jsonResponse([{ telegram_id: 2 }, { telegram_id: 3 }]); // payants actifs
        if (url.includes("users")) return jsonResponse([{ telegram_id: 1 }, { telegram_id: 2 }, { telegram_id: 3 }, { telegram_id: 4 }]); // total
        if (url.includes("signals") && url.includes("outcome=not.is.null")) {
          return jsonResponse([{ outcome: "WIN" }, { outcome: "WIN" }, { outcome: "LOSS" }]);
        }
        if (url.includes("pending_payments") && url.includes("method=eq.USDT") && (!init || init.method === undefined)) {
          return jsonResponse([{ amount_expected: 19 }, { amount_expected: 39 }]);
        }
        if (url.includes("daily_stats") && init?.method === "POST") {
          insertedStats = JSON.parse(init.body as string);
          return jsonResponse([insertedStats]);
        }
        if (url.includes("momentum_alerts") && init?.method === "DELETE") {
          purgedMomentum = true;
          return new Response(null, { status: 204 });
        }
        // Le journal de diffusion (voir channelBudget.ts) est purgé ici aussi :
        // il ne sert qu'aux décisions du jour et au diagnostic récent.
        if (url.includes("channel_posts") && init?.method === "DELETE") {
          purgedJournal = true;
          return new Response(null, { status: 204 });
        }
        if (url.includes("pending_payments") && init?.method === "PATCH") {
          expiredPayments = true;
          const body = JSON.parse(init.body as string);
          expect(body.status).toBe("expired");
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await runDailyMaintenance(env);

    expect(insertedStats.total_users).toBe(4);
    expect(insertedStats.active_trials).toBe(1);
    expect(insertedStats.paying_subscribers).toBe(2);
    expect(insertedStats.winrate_rolling_30d).toBeCloseTo(2 / 3);
    expect(insertedStats.total_revenue_usdt).toBe(58);
    expect(purgedMomentum).toBe(true);
    expect(purgedJournal).toBe(true);
    expect(expiredPayments).toBe(true);
  });

  it("winrate_rolling_30d reste null (jamais 0 fabriqué) si aucun signal résolu sur 30 jours", async () => {
    let insertedStats: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("daily_stats") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("users")) return jsonResponse([]);
        if (url.includes("signals")) return jsonResponse([]);
        if (url.includes("pending_payments") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("daily_stats") && init?.method === "POST") {
          insertedStats = JSON.parse(init.body as string);
          return jsonResponse([insertedStats]);
        }
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await runDailyMaintenance(env);
    expect(insertedStats.winrate_rolling_30d).toBeNull();
    expect(insertedStats.total_revenue_usdt).toBe(0);
  });
});
