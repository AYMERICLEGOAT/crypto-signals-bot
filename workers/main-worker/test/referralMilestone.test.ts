import { describe, it, expect, vi, afterEach } from "vitest";
import { maybeRewardReferral, REFERRAL_BONUS_DAYS, MILESTONE_BONUS_DAYS, JOKER_BONUS_DAYS } from "../src/bot/referral";

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
        if (url.includes("referral_rewards") && init?.method === "POST") return jsonResponse([]);
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
        if (url.includes("referral_rewards") && init?.method === "POST") return jsonResponse([]);
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

  it("crédite quand même le parrain et notifie même si l'enregistrement pour le leaderboard échoue (table absente, etc.)", async () => {
    const referred = makeUser({ telegram_id: 70, referred_by: 7, referral_rewarded: false });
    const referrer = makeUser({ telegram_id: 7, paid_referral_count: 0 });

    let activated = false;
    let sentText = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.70") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.7") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.7") && init?.method === "PATCH") {
          activated = true;
          return jsonResponse([]);
        }
        if (url.includes("telegram_id=eq.70") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("referral_rewards") && init?.method === "POST") {
          return new Response("relation \"referral_rewards\" does not exist", { status: 404 });
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await expect(maybeRewardReferral(env, 70)).resolves.not.toThrow();
    expect(activated).toBe(true);
    expect(sentText).toContain(`+${REFERRAL_BONUS_DAYS} jours`);
  });
});

describe("maybeRewardReferral — bonus Joker (Bloc 6)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ajoute le bonus Joker si le parrain parraine dans les 48h avant l'expiration de son abonnement", async () => {
    const expiresSoon = new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(); // dans 10h
    const referred = makeUser({ telegram_id: 40, referred_by: 4, referral_rewarded: false });
    const referrer = makeUser({ telegram_id: 4, paid_referral_count: 0, expiration: expiresSoon });

    let sentText = "";
    let recordedReward: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.40") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.4") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.4") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("telegram_id=eq.40") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("referral_rewards") && init?.method === "POST") {
          recordedReward = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 40);

    expect(sentText).toContain("Bonus Joker");
    expect(sentText).toContain(`+${JOKER_BONUS_DAYS} jours`);
    expect(recordedReward.joker_hit).toBe(true);
    expect(recordedReward.bonus_days).toBe(REFERRAL_BONUS_DAYS + JOKER_BONUS_DAYS);
  });

  it("n'ajoute PAS le bonus Joker si l'abonnement du parrain est déjà expiré", async () => {
    const expiredSince = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // il y a 1h
    const referred = makeUser({ telegram_id: 50, referred_by: 5, referral_rewarded: false });
    const referrer = makeUser({ telegram_id: 5, paid_referral_count: 0, expiration: expiredSince });

    let sentText = "";
    let recordedReward: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.50") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.5") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.5") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("telegram_id=eq.50") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("referral_rewards") && init?.method === "POST") {
          recordedReward = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 50);

    expect(sentText).not.toContain("Bonus Joker");
    expect(recordedReward.joker_hit).toBe(false);
    expect(recordedReward.bonus_days).toBe(REFERRAL_BONUS_DAYS);
  });

  it("n'ajoute PAS le bonus Joker si l'abonnement du parrain expire dans plus de 48h", async () => {
    const expiresLater = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(); // dans 20 jours
    const referred = makeUser({ telegram_id: 60, referred_by: 6, referral_rewarded: false });
    const referrer = makeUser({ telegram_id: 6, paid_referral_count: 0, expiration: expiresLater });

    let recordedReward: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.60") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.6") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.6") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("telegram_id=eq.60") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("referral_rewards") && init?.method === "POST") {
          recordedReward = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 60);
    expect(recordedReward.joker_hit).toBe(false);
  });
});

describe("maybeRewardReferral — anti-abus même wallet (Bloc 10)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuse la récompense si le filleul et le parrain ont la même adresse wallet (auto-parrainage)", async () => {
    const sameWallet = "0xabcabcabcabcabcabcabcabcabcabcabcabcabc";
    const referred = makeUser({ telegram_id: 80, referred_by: 8, referral_rewarded: false, wallet_address: sameWallet });
    const referrer = makeUser({ telegram_id: 8, paid_referral_count: 0, wallet_address: sameWallet });

    let referrerActivated = false;
    let markedRewarded = false;
    let notified = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.80") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.8") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.8") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if ("plan" in body || "expiration" in body) referrerActivated = true;
          if (body.referral_rewarded === true) markedRewarded = true;
          return jsonResponse([]);
        }
        if (url.includes("telegram_id=eq.80") && init?.method === "PATCH") {
          if (JSON.parse(init.body as string).referral_rewarded === true) markedRewarded = true;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          notified = true;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 80);

    expect(referrerActivated).toBe(false); // aucun bonus de jours accordé
    expect(markedRewarded).toBe(true); // mais ce parrainage ne sera jamais retenté
    expect(notified).toBe(false); // aucune notification "tu as gagné des jours"
  });

  it("récompense normalement si les wallets sont différents", async () => {
    const referred = makeUser({ telegram_id: 90, referred_by: 9, referral_rewarded: false, wallet_address: "0x1111111111111111111111111111111111aaaa" });
    const referrer = makeUser({ telegram_id: 9, paid_referral_count: 0, wallet_address: "0x2222222222222222222222222222222222bbbb" });

    let notified = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.90") && isGet) return jsonResponse([referred]);
        if (url.includes("telegram_id=eq.9") && isGet) return jsonResponse([referrer]);
        if (url.includes("telegram_id=eq.9") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("telegram_id=eq.90") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("referral_rewards") && init?.method === "POST") return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          notified = true;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await maybeRewardReferral(env, 90);
    expect(notified).toBe(true);
  });
});
