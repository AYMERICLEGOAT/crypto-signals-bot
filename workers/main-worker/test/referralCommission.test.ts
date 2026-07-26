import { describe, it, expect, vi, afterEach } from "vitest";
import { maybeRewardReferral } from "../src/bot/referral";
import { getTotalCommissions } from "../src/db/referralRewards";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;
const db = { url: "https://fake-supabase.test", key: "k" };

function makeUser(overrides: Record<string, unknown>) {
  return {
    telegram_id: 1,
    wallet_address: null,
    plan: 1,
    expiration: null,
    trial_used: false,
    created_at: "2026-01-01T00:00:00Z",
    referred_by: null,
    referral_rewarded: false,
    plan_started_at: "2026-01-01T00:00:00Z",
    paid_referral_count: 0,
    ...overrides,
  };
}

describe("maybeRewardReferral — commission virtuelle (Bloc 22)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("crédite 10% du prix du plan payé par le filleul (Standard = 19 -> 1.90)", async () => {
    const referred = makeUser({ telegram_id: 10, referred_by: 1, referral_rewarded: false, plan: 1 }); // Standard, 19 USDT
    const referrer = makeUser({ telegram_id: 1 });

    let sentText = "";
    let recordedCommission: number | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.10") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.1") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.1") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("telegram_id=eq.10") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("referral_rewards") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          recordedCommission = body.commission_usd;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 10);

    expect(recordedCommission).toBeCloseTo(1.9);
    expect(sentText).toContain("1.90 USDT");
    expect(sentText).toContain("non versée automatiquement");
  });

  it("getTotalCommissions additionne toutes les commissions enregistrées pour un parrain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("referral_rewards")) return jsonResponse([{ commission_usd: 1.9 }, { commission_usd: 3.9 }]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const total = await getTotalCommissions(db, 1);
    expect(total).toBeCloseTo(5.8);
  });
});
