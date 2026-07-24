import { describe, it, expect, vi, afterEach } from "vitest";
import { maybeRewardReferral, REFERRAL_BONUS_DAYS, MILESTONE_BONUS_DAYS } from "../src/bot/referral";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

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

describe("maybeRewardReferral — palier des 3 filleuls payants", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("+7 jours seulement quand le palier n'est pas atteint (1er ou 2e filleul payant)", async () => {
    const referred = makeUser({ telegram_id: 10, referred_by: 1, referral_rewarded: false });
    const referrer = makeUser({ telegram_id: 1, paid_referral_count: 1 }); // ce sera son 2e filleul payant

    let sentText = "";
    let newCount: number | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.10") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.1") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.1") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if ("paid_referral_count" in body) newCount = body.paid_referral_count;
          return jsonResponse([]);
        }
        if (url.includes("telegram_id=eq.10") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 10);

    expect(newCount).toBe(2);
    expect(sentText).toContain(`+${REFERRAL_BONUS_DAYS} jours`);
    expect(sentText).not.toContain("Palier atteint");
  });

  it("+7 jours ET +30 jours quand le 3e filleul payant est atteint", async () => {
    const referred = makeUser({ telegram_id: 20, referred_by: 2, referral_rewarded: false });
    const referrer = makeUser({ telegram_id: 2, paid_referral_count: 2 }); // ce sera son 3e

    let sentText = "";
    let newCount: number | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.20") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.2") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.2") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if ("paid_referral_count" in body) newCount = body.paid_referral_count;
          return jsonResponse([]);
        }
        if (url.includes("telegram_id=eq.20") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 20);

    expect(newCount).toBe(3);
    expect(sentText).toContain("Palier atteint");
    expect(sentText).toContain(`+${MILESTONE_BONUS_DAYS} jours`);
  });

  it("ne fait rien si le filleul n'a pas de parrain ou a déjà été récompensé", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("telegram_id=eq.30")) return jsonResponse([makeUser({ telegram_id: 30, referred_by: null })]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await maybeRewardReferral(env, 30);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
