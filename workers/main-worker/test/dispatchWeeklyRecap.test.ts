import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { dispatchWeeklyRecap } from "../src/cron/dispatchWeeklyRecap";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", TELEGRAM_CHANNEL_ID: "-100123", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

// 2026-08-02 est un dimanche.
const SUNDAY_19H_UTC = new Date("2026-08-02T19:00:00Z");
const MONDAY_10H_UTC = new Date("2026-08-03T10:00:00Z");

describe("dispatchWeeklyRecap", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("publie le récap le dimanche après 18h UTC si pas encore fait cette semaine", async () => {
    vi.setSystemTime(SUNDAY_19H_UTC);
    let posted = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("weekly_recap_posts") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("/users") && url.includes("expiration=gt.")) return jsonResponse([]);
        if (url.includes("signals") && url.includes("evaluated_at=gte.")) {
          return jsonResponse([
            { type: "BUY", entry_price: 100, outcome_price: 104, close_reason: "tp_hit" },
            { type: "SELL", entry_price: 50, outcome_price: 51, close_reason: "sl_hit" },
          ]);
        }
        if (url.includes("signals") && url.includes("created_at=gte.")) {
          return jsonResponse([{ id: 1 }, { id: 2 }, { id: 3 }]);
        }
        if (url.includes("momentum_alerts")) return jsonResponse([{ id: 1 }]);
        if (url.includes("api.telegram.org")) {
          posted = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("weekly_recap_posts") && init?.method === "POST") return jsonResponse([{}]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchWeeklyRecap(env);
    expect(posted).toContain("3 signal");
    expect(posted).toContain("1 take profit");
    expect(posted).toContain("1 stop loss");
    expect(posted).toContain("1 alerte(s) momentum");
  });

  it("ne fait rien en dehors du créneau dimanche 18h UTC", async () => {
    vi.setSystemTime(MONDAY_10H_UTC);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchWeeklyRecap(env);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne republie pas si déjà fait cette semaine", async () => {
    vi.setSystemTime(SUNDAY_19H_UTC);
    const fetchSpy = vi.fn(async () => jsonResponse([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchWeeklyRecap(env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
