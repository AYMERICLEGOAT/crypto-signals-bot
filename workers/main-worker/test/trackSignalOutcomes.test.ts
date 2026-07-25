import { describe, it, expect, vi, afterEach } from "vitest";
import { trackSignalOutcomes } from "../src/cron/trackSignalOutcomes";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

const recentSignal = {
  id: 1,
  pair: "BTC/USDT",
  type: "BUY",
  entry_price: 100,
  stop_loss: 95,
  take_profit: 110,
  created_at: new Date().toISOString(),
  sent: true,
  chart_url: null,
  sent_to_channel: true,
  sent_to_standard: true,
  outcome: null,
  outcome_price: null,
  close_reason: null,
};

describe("trackSignalOutcomes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clôture en WIN quand le take profit est atteint, notifie les destinataires et célèbre publiquement", async () => {
    let closedPatch: any = null;
    const dmSentTo: number[] = [];
    let publicText = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([recentSignal]);
        }
        if (url.includes("binance.com")) {
          return jsonResponse([{ symbol: "BTCUSDT", price: "112.00" }]);
        }
        if (url.includes("signals") && init?.method === "PATCH") {
          closedPatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 10 }, { telegram_id: 11 }]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          if (body.chat_id === -100123456) publicText = body.text;
          else dmSentTo.push(body.chat_id);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(env);

    expect(closedPatch.outcome).toBe("WIN");
    expect(closedPatch.close_reason).toBe("tp_hit");
    expect(closedPatch.outcome_price).toBe(112);
    expect(dmSentTo.sort()).toEqual([10, 11]);
    expect(publicText).toContain("Objectif atteint");
    expect(publicText).toContain("ProVIPSignals");
  });

  it("clôture en LOSS quand le stop loss est touché, message calme sans ton festif", async () => {
    let closedPatch: any = null;
    let publicText = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([recentSignal]);
        }
        if (url.includes("binance.com")) {
          return jsonResponse([{ symbol: "BTCUSDT", price: "94.00" }]);
        }
        if (url.includes("signals") && init?.method === "PATCH") {
          closedPatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          if (body.chat_id === -100123456) publicText = body.text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(env);

    expect(closedPatch.outcome).toBe("LOSS");
    expect(closedPatch.close_reason).toBe("sl_hit");
    expect(publicText).toContain("clôturé");
    expect(publicText).not.toContain("🎉");
  });

  it("clôture en LOSS/expired après 10 jours sans avoir touché ni le TP ni le SL", async () => {
    const oldSignal = { ...recentSignal, id: 2, created_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString() };
    let closedPatch: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([oldSignal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "103.00" }]); // ni TP ni SL
        if (url.includes("signals") && init?.method === "PATCH") {
          closedPatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(env);

    expect(closedPatch.outcome).toBe("LOSS");
    expect(closedPatch.close_reason).toBe("expired");
  });

  it("laisse un signal ouvert tel quel si ni le TP ni le SL ne sont atteints et qu'il n'a pas expiré", async () => {
    let patched = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([recentSignal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "103.00" }]);
        if (url.includes("signals") && init?.method === "PATCH") {
          patched = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(env);
    expect(patched).toBe(false);
  });

  it("ne poste rien sur le canal public si le signal n'y a jamais été diffusé", async () => {
    const privateOnlySignal = { ...recentSignal, id: 3, sent_to_channel: false };
    let publicPosted = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([privateOnlySignal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "112.00" }]);
        if (url.includes("signals") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          if (body.chat_id === -100123456) publicPosted = true;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(env);
    expect(publicPosted).toBe(false);
  });

  it("ne fait rien si aucun signal n'est ouvert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await trackSignalOutcomes(env);
  });

  it("échoue proprement (sans planter) si Binance est indisponible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("signals") && url.includes("outcome=is.null")) return jsonResponse([recentSignal]);
        if (url.includes("binance.com")) return new Response("erreur", { status: 500 });
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    await trackSignalOutcomes(env);
  });
});
