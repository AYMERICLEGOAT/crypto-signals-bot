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
        // ATTENTION ordre : "telegram_id=eq.1".includes-match sur "telegram_id=eq.10" aussi
        // (sous-chaîne) -- les checks visant spécifiquement id=10 doivent passer AVANT
        // le check générique id=1, sinon ce dernier intercepte tout en premier.
        // La réclamation atomique (referral_rewarded=eq.false) doit renvoyer une ligne non vide pour "gagner" -- voir claimReferralReward.
        if (url.includes("telegram_id=eq.10") && url.includes("referral_rewarded=eq.false") && init?.method === "PATCH") {
          return jsonResponse([{ telegram_id: 10, referral_rewarded: true }]);
        }
        if (url.includes("telegram_id=eq.10") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("telegram_id=eq.1") && init?.method === "PATCH") return jsonResponse([]);
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

  it("ne crédite pas le parrain une deuxième fois si la réclamation atomique a déjà été gagnée entre-temps (race TOCTOU, audit du 31/07)", async () => {
    const referred = makeUser({ telegram_id: 10, referred_by: 1, referral_rewarded: false, plan: 1 });
    const referrer = makeUser({ telegram_id: 1 });
    let creditingHappened = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.10") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.1") && isGet) return jsonResponse([referrer]);
        // Simule le cas de la race : la lecture ci-dessus montrait encore
        // referral_rewarded=false, mais l'UPDATE atomique WHERE referral_rewarded
        // = false n'affecte plus aucune ligne car une autre invocation a gagné
        // la course entre-temps -- 0 ligne retournée.
        if (url.includes("telegram_id=eq.10") && url.includes("referral_rewarded=eq.false") && init?.method === "PATCH") {
          return jsonResponse([]);
        }
        if (url.includes("telegram_id=eq.1") && init?.method === "PATCH") {
          creditingHappened = true; // activateSubscription/paid_referral_count : ne doit jamais être atteint
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 10);
    expect(creditingHappened).toBe(false);
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
