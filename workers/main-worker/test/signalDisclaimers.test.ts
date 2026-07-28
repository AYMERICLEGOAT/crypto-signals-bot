import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchSignals } from "../src/cron/dispatchSignals";
import { dispatchStandardTier } from "../src/cron/dispatchStandardTier";
import { dispatchPublicChannel } from "../src/cron/dispatchPublicChannel";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const DISCLAIMER = "Pas un conseil financier";

const baseSignal = {
  id: 1,
  pair: "BTCUSDT",
  type: "BUY",
  entry_price: 100,
  stop_loss: 95,
  take_profit: 110,
  created_at: "2026-01-01T00:00:00Z",
  sent: false,
  chart_url: null,
  sent_to_channel: false,
  sent_to_standard: false,
};

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

describe("Bloc 10 — disclaimer de risque sur les vrais signaux", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dispatchSignals (Pro/essai) inclut le disclaimer", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("sent=eq.false")) return jsonResponse([{ ...baseSignal, sent: false }]);
        if (url.includes("users") && url.includes("expiration=gt")) return jsonResponse([{ telegram_id: 1, plan: 2, expiration: "2099-01-01T00:00:00Z" }]);
        if (url.includes("user_prefs")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("signal_deliveries") || (url.includes("signals") && init?.method === "PATCH")) return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchSignals(env);
    expect(text).toContain(DISCLAIMER);
  });

  it("dispatchStandardTier (Standard/Découverte) inclut le disclaimer", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("sent_to_standard=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([{ ...baseSignal, sent: true, created_at: "2020-01-01T00:00:00Z" }]);
        }
        if (url.includes("users") && url.includes("expiration=gt")) return jsonResponse([{ telegram_id: 3, plan: 1, expiration: "2099-01-01T00:00:00Z" }]);
        if (url.includes("user_prefs")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("signal_deliveries") || (url.includes("signals") && init?.method === "PATCH")) return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchStandardTier(env);
    expect(text).toContain(DISCLAIMER);
  });

  it("dispatchPublicChannel inclut le disclaimer", async () => {
    let text = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("sent_to_channel=eq.false")) {
          return jsonResponse([{ ...baseSignal, sent: true, sent_to_channel: false, created_at: "2020-01-01T00:00:00Z" }]);
        }
        if (url.includes("api.telegram.org")) {
          text = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("signals") && init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchPublicChannel(env);
    expect(text).toContain(DISCLAIMER);
  });
});
