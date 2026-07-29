import { describe, it, expect, vi, afterEach } from "vitest";
import { isValidPlan, PLAN_DURATION_DAYS, DISCOVERY_PLAN, STANDARD_PLAN, PRO_PLAN } from "../src/payments/plans";
import { getRemainingDiscoverySlots, incrementDiscoverySlotsUsed } from "../src/db/offerCounter";
import { buildPlanKeyboard } from "../src/bot/keyboards";
import { dispatchSignals } from "../src/cron/dispatchSignals";
import { dispatchStandardTier } from "../src/cron/dispatchStandardTier";
import { startUsdtPayment } from "../src/payments/usdt";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  PAYMENT_ADDRESS_USDT: "0xreceiver",
  MONERO_MIN_CONFIRMATIONS: "10",
} as any;

describe("plans.ts", () => {
  it("isValidPlan n'accepte que 1, 2 ou 3", () => {
    expect(isValidPlan(1)).toBe(true);
    expect(isValidPlan(2)).toBe(true);
    expect(isValidPlan(3)).toBe(true);
    expect(isValidPlan(0)).toBe(false);
    expect(isValidPlan(4)).toBe(false);
  });

  it("Découverte dure 14 jours, Standard et Pro 30 jours", () => {
    expect(PLAN_DURATION_DAYS[DISCOVERY_PLAN]).toBe(14);
    expect(PLAN_DURATION_DAYS[STANDARD_PLAN]).toBe(30);
    expect(PLAN_DURATION_DAYS[PRO_PLAN]).toBe(30);
  });
});

describe("offerCounter", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calcule les places restantes réelles (total - utilisées)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ offer_name: "decouverte", slots_total: 50, slots_used: 47 }])));
    const remaining = await getRemainingDiscoverySlots({ url: env.SUPABASE_URL, key: env.SUPABASE_KEY });
    expect(remaining).toBe(3);
  });

  it("retourne 0 (jamais négatif) si le compteur est épuisé ou dépassé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ offer_name: "decouverte", slots_total: 50, slots_used: 52 }])));
    const remaining = await getRemainingDiscoverySlots({ url: env.SUPABASE_URL, key: env.SUPABASE_KEY });
    expect(remaining).toBe(0);
  });

  it("incrémente slots_used via l'UPDATE atomique increment_offer_slot (anti-race, voir Audit#28)", async () => {
    let rpcArgs: unknown = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/rpc/increment_offer_slot")) {
          rpcArgs = JSON.parse(init!.body as string);
          return jsonResponse([{ offer_name: "decouverte", slots_total: 50, slots_used: 11 }]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    await incrementDiscoverySlotsUsed({ url: env.SUPABASE_URL, key: env.SUPABASE_KEY });
    expect(rpcArgs).toEqual({ p_offer_name: "decouverte" });
  });
});

describe("buildPlanKeyboard", () => {
  it("affiche Standard, Pro et Découverte (avec le compteur réel) s'il reste des places", () => {
    const kb = buildPlanKeyboard(7);
    const labels = kb.flat().map((b) => b.text);
    expect(labels.some((l) => l.includes("Standard"))).toBe(true);
    expect(labels.some((l) => l.includes("Pro"))).toBe(true);
    expect(labels.some((l) => l.includes("Découverte") && l.includes("7 places"))).toBe(true);
  });

  it("masque complètement l'offre Découverte si les places sont épuisées", () => {
    const kb = buildPlanKeyboard(0);
    const labels = kb.flat().map((b) => b.text);
    expect(labels.some((l) => l.includes("Découverte"))).toBe(false);
    expect(labels).toHaveLength(2);
  });

  it("Audit#19 : masque Pro quand proPlanVisible=false, sans toucher Standard/Découverte", () => {
    const kb = buildPlanKeyboard(7, false);
    const labels = kb.flat().map((b) => b.text);
    expect(labels.some((l) => l.includes("Standard"))).toBe(true);
    expect(labels.some((l) => l.includes("Pro"))).toBe(false);
    expect(labels.some((l) => l.includes("Découverte"))).toBe(true);
  });
});

describe("Effet Sniper — dispatchSignals (vitesse Pro/essai)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("n'envoie qu'aux abonnés Pro et essai gratuit, jamais à Standard/Découverte, et trace les livraisons (Bloc 4)", async () => {
    const notified: number[] = [];
    let recordedDeliveries: any[] | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("sent=eq.false")) {
          return jsonResponse([
            { id: 1, pair: "BTCUSDT", type: "BUY", entry_price: 100, stop_loss: 95, take_profit: 110, created_at: "2026-01-01T00:00:00Z", sent: false, chart_url: null, sent_to_channel: false, sent_to_standard: false },
          ]);
        }
        if (url.includes("users") && url.includes("expiration=gt")) {
          return jsonResponse([
            { telegram_id: 1, plan: 2, expiration: "2099-01-01T00:00:00Z" }, // Pro
            { telegram_id: 2, plan: 0, expiration: "2099-01-01T00:00:00Z" }, // essai
            { telegram_id: 3, plan: 1, expiration: "2099-01-01T00:00:00Z" }, // Standard
            { telegram_id: 4, plan: 3, expiration: "2099-01-01T00:00:00Z" }, // Découverte
          ]);
        }
        if (url.includes("user_prefs")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          notified.push(JSON.parse(init!.body as string).chat_id);
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("signal_deliveries") && init?.method === "POST") {
          recordedDeliveries = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signals") && init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchSignals(env);
    expect(notified.sort()).toEqual([1, 2]);
    expect(recordedDeliveries).toEqual(
      expect.arrayContaining([
        { signal_id: 1, telegram_id: 1, tier: "pro" },
        { signal_id: 1, telegram_id: 2, tier: "pro" },
      ])
    );
    expect(recordedDeliveries).toHaveLength(2);
  });
});

describe("Effet Sniper — dispatchStandardTier (délai Standard/Découverte)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("n'envoie qu'aux abonnés pas encore livrés (le Pro déjà notifié en immédiat est exclu), marque sent_to_standard et trace les livraisons (Bloc 4)", async () => {
    const notified: number[] = [];
    let marked = false;
    let recordedDeliveries: any[] | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("sent_to_standard=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([
            { id: 1, pair: "BTCUSDT", type: "BUY", entry_price: 100, stop_loss: 95, take_profit: 110, created_at: "2020-01-01T00:00:00Z", sent: true, chart_url: null, sent_to_channel: false, sent_to_standard: false },
          ]);
        }
        if (url.includes("users") && url.includes("expiration=gt")) {
          return jsonResponse([
            { telegram_id: 1, plan: 2, expiration: "2099-01-01T00:00:00Z" }, // Pro (ne doit pas recevoir ici)
            { telegram_id: 3, plan: 1, expiration: "2099-01-01T00:00:00Z" }, // Standard
            { telegram_id: 4, plan: 3, expiration: "2099-01-01T00:00:00Z" }, // Découverte
          ]);
        }
        if (url.includes("user_prefs")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          notified.push(JSON.parse(init!.body as string).chat_id);
          return jsonResponse({ ok: true, result: {} });
        }
        // Effet Sniper (nouvelle cible "pas encore livré" plutôt que par plan
        // figé) : le Pro (telegram_id 1) a déjà reçu ce signal via le lot
        // immédiat (dispatchSignals.ts) -- reproduit ici pour vérifier qu'il
        // n'est bien PAS renotifié par ce lot différé.
        if (url.includes("signal_deliveries") && url.includes("select=telegram_id")) {
          return jsonResponse([{ telegram_id: 1 }]);
        }
        if (url.includes("signal_deliveries") && init?.method === "POST") {
          recordedDeliveries = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signals") && init?.method === "PATCH") {
          if (JSON.parse(init.body as string).sent_to_standard === true) marked = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchStandardTier(env);
    expect(notified.sort()).toEqual([3, 4]);
    expect(marked).toBe(true);
    expect(recordedDeliveries).toEqual(
      expect.arrayContaining([
        { signal_id: 1, telegram_id: 3, tier: "standard" },
        { signal_id: 1, telegram_id: 4, tier: "standard" },
      ])
    );
    expect(recordedDeliveries).toHaveLength(2);
  });

  it("ne fait rien si aucun signal n'est dû", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await dispatchStandardTier(env);
  });
});

describe("Découverte — anti-abus par wallet (USDT)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuse une nouvelle Découverte pour un wallet qui l'a déjà utilisée, sans créer de paiement", async () => {
    let pendingPaymentCreated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && url.includes("discovery_used=eq.true")) {
          return jsonResponse([{ telegram_id: 999, wallet_address: "0xabc", discovery_used: true }]);
        }
        if (url.includes("pending_payments")) {
          pendingPaymentCreated = true;
          return jsonResponse([{}]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const message = await startUsdtPayment(env, { url: env.SUPABASE_URL, key: env.SUPABASE_KEY }, 42, DISCOVERY_PLAN, "0xABC");
    expect(message).toContain("déjà utilisé");
    expect(pendingPaymentCreated).toBe(false);
  });

  it("accepte une Découverte pour un wallet neuf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && url.includes("discovery_used=eq.true")) return jsonResponse([]);
        if (url.includes("users") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("users") && url.includes("telegram_id=eq.")) return jsonResponse([]);
        if (url.includes("promo_codes")) return jsonResponse([]);
        if (url.includes("pending_payments") && init?.method === "POST") return jsonResponse([{ id: 1 }]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const message = await startUsdtPayment(env, { url: env.SUPABASE_URL, key: env.SUPABASE_KEY }, 42, DISCOVERY_PLAN, "0xNEW");
    expect(message).toContain("Découverte");
    expect(message).toContain("14 jours");
  });
});
