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
        if (url.includes("/users") && url.includes("telegram_id=in.")) return jsonResponse([]);
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

  // Chaque moteur a été validé sur SA durée de détention : 7 jours pour la
  // force relative, 3 jours pour le momentum 4 h. Les fermer tous à 10 jours
  // reviendrait à jouer une stratégie que personne n'a mesurée. Ces deux tests
  // vérifient que l'échéance portée par le signal fait autorité dans les deux
  // sens — elle raccourcit ET elle prolonge.
  async function suivreAvecPrixStable(signal: any) {
    let closedPatch: any = null;
    let messageAbonne = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([signal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "103.00" }]);
        if (url.includes("signals") && init?.method === "PATCH") {
          closedPatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 10 }]);
        }
        if (url.includes("/users") && url.includes("telegram_id=in.")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          if (body.chat_id === 10) messageAbonne = body.text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    await trackSignalOutcomes(env);
    return { closedPatch, messageAbonne };
  }

  it("clôture un signal momentum 4H à SON échéance de 3 jours, sans attendre les 10 jours du filet de sécurité", async () => {
    const ouverture = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const signal4h = {
      ...recentSignal,
      id: 20,
      engine: "momentum_4h",
      created_at: ouverture.toISOString(),
      hold_until: new Date(ouverture.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const { closedPatch, messageAbonne } = await suivreAvecPrixStable(signal4h);

    expect(closedPatch).not.toBeNull();
    expect(closedPatch.close_reason).toBe("expired");
    // Le message annonce la durée réellement prévue, pas la constante du suivi.
    expect(messageAbonne).toContain("3 jours");
    expect(messageAbonne).not.toContain("10 jours");
  });

  it("garde ouvert un carry de 21 jours au-delà des 10 jours du filet de sécurité", async () => {
    const ouverture = new Date(Date.now() - 12 * 24 * 60 * 60 * 1000);
    const signalLong = {
      ...recentSignal,
      id: 21,
      engine: "relative_strength",
      created_at: ouverture.toISOString(),
      hold_until: new Date(ouverture.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const { closedPatch } = await suivreAvecPrixStable(signalLong);

    expect(closedPatch).toBeNull();
  });

  it("retombe sur les 10 jours pour un signal sans échéance propre (antérieur à hold_until)", async () => {
    const ancien = {
      ...recentSignal,
      id: 22,
      created_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
      hold_until: null,
    };

    const { closedPatch } = await suivreAvecPrixStable(ancien);

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

  it("UX — remonte le trailing stop et ne notifie que les abonnés l'ayant activé (/prefs), sans clôturer le signal", async () => {
    let trailingPatch: any = null;
    const dmSentTo: number[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([recentSignal]); // entrée 100, stop 95 -> R=5
        }
        if (url.includes("binance.com")) {
          return jsonResponse([{ symbol: "BTCUSDT", price: "106.00" }]); // +1R, ni TP (110) ni SL
        }
        if (url.includes("signals") && init?.method === "PATCH") {
          trailingPatch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 10 }, { telegram_id: 11 }]);
        }
        if (url.includes("user_prefs") && url.includes("telegram_id=in.")) {
          return jsonResponse([{ telegram_id: 10, trailing_stop: true }, { telegram_id: 11, trailing_stop: false }]);
        }
        if (url.includes("api.telegram.org")) {
          dmSentTo.push(JSON.parse(init!.body as string).chat_id);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(env);

    expect(trailingPatch.trailing_stop_price).toBe(100); // point mort (entrée)
    expect(dmSentTo).toEqual([10]); // seul l'abonné ayant activé la préférence est notifié
  });

  // Mission "grille d'excellence" — entrée 100, SL 97, TP1 103, TP2 106, TP3 110.
  const multiTpSignal = {
    ...recentSignal,
    id: 5,
    stop_loss: 97,
    tp1_price: 103,
    tp2_price: 106,
    tp3_price: 110,
    tp1_hit_at: null,
    tp2_hit_at: null,
    tp3_hit_at: null,
    breakeven_active: false,
  };

  it("Multi-TP — TP1 atteint : notifie, passe au break-even, NE clôture PAS le signal", async () => {
    let patch: any = null;
    const dmSentTo: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([multiTpSignal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "103.50" }]);
        if (url.includes("signals") && init?.method === "PATCH") {
          patch = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) return jsonResponse([{ telegram_id: 10 }]);
        if (url.includes("api.telegram.org")) {
          dmSentTo.push(JSON.parse(init!.body as string).chat_id);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(env);

    expect(patch.breakeven_active).toBe(true);
    expect(patch.outcome).toBeUndefined(); // pas de clôture
    expect(dmSentTo).toEqual([10]);
  });

  it("Multi-TP — stop au break-even touché après TP1 : clôture en WIN (jamais perdant une fois sécurisé)", async () => {
    let closedPatch: any = null;
    const afterTp1 = { ...multiTpSignal, tp1_hit_at: new Date().toISOString(), breakeven_active: true };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([afterTp1]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "100.00" }]); // retombe au break-even
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

    expect(closedPatch.outcome).toBe("WIN");
    expect(closedPatch.close_reason).toBe("tp_hit");
    expect(closedPatch.outcome_price).toBe(100);
  });

  it("Multi-TP — stop original touché AVANT TP1 : vraie perte", async () => {
    let closedPatch: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([multiTpSignal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "97.00" }]);
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
    expect(closedPatch.close_reason).toBe("sl_hit");
  });

  it("Étape 2 (célébrations) — TP2 atteint : diffuse un message festif au canal VIP et un texte partageable en DM", async () => {
    const envWithVip = { ...env, TELEGRAM_VIP_CHANNEL_ID: "-100999" };
    const afterTp1 = { ...multiTpSignal, tp1_hit_at: new Date().toISOString(), breakeven_active: true };
    const dmTexts: string[] = [];
    let vipMessage = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([afterTp1]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "106.00" }]); // atteint TP2 (106)
        if (url.includes("signals") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) return jsonResponse([{ telegram_id: 10 }]);
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          if (body.chat_id === -100999) vipMessage = body.text;
          else dmTexts.push(body.text);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(envWithVip);

    expect(vipMessage).toContain("TP2 ATTEINT");
    expect(vipMessage).toContain("BTC/USDT");
    expect(dmTexts.some((t) => t.includes("À partager"))).toBe(true);
  });

  it("Étape 2 (célébrations) — sans TELEGRAM_VIP_CHANNEL_ID configuré, aucune diffusion VIP tentée (pas d'erreur)", async () => {
    const afterTp1 = { ...multiTpSignal, tp1_hit_at: new Date().toISOString(), breakeven_active: true };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([afterTp1]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "106.00" }]);
        if (url.includes("signals") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) return jsonResponse([{ telegram_id: 10 }]);
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await expect(trackSignalOutcomes(env)).resolves.not.toThrow();
  });

  it("Étape 2 (célébrations) — TP3 atteint : diffuse aussi un message festif au canal VIP", async () => {
    const envWithVip = { ...env, TELEGRAM_VIP_CHANNEL_ID: "-100999" };
    const afterTp2 = { ...multiTpSignal, tp1_hit_at: new Date().toISOString(), tp2_hit_at: new Date().toISOString(), breakeven_active: true };
    let vipMessage = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([afterTp2]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "110.00" }]);
        if (url.includes("signals") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) return jsonResponse([{ telegram_id: 10 }]);
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          if (body.chat_id === -100999) vipMessage = body.text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await trackSignalOutcomes(envWithVip);

    expect(vipMessage).toContain("TP3 ATTEINT");
  });

  it("Multi-TP — TP3 atteint (après TP1+TP2) : clôture en WIN au prix de TP3", async () => {
    let closedPatch: any = null;
    const afterTp2 = { ...multiTpSignal, tp1_hit_at: new Date().toISOString(), tp2_hit_at: new Date().toISOString(), breakeven_active: true };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([afterTp2]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "110.00" }]);
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

    expect(closedPatch.outcome).toBe("WIN");
    expect(closedPatch.close_reason).toBe("tp_hit");
    expect(closedPatch.outcome_price).toBe(110);
  });

  it("Multi-TP — expire après 10 jours SANS avoir atteint TP1 : LOSS/expired (comme un signal classique)", async () => {
    const oldSignal = { ...multiTpSignal, id: 6, created_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString() };
    let closedPatch: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([oldSignal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "101.00" }]); // ni SL ni TP1
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

  it("Multi-TP — expire après 10 jours APRÈS avoir sécurisé TP1 : WIN (jamais pénalisé une fois sécurisé)", async () => {
    const oldSignal = {
      ...multiTpSignal,
      id: 7,
      tp1_hit_at: new Date().toISOString(),
      breakeven_active: true,
      created_at: new Date(Date.now() - 11 * 24 * 60 * 60 * 1000).toISOString(),
    };
    let closedPatch: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signals") && url.includes("outcome=is.null") && (!init || init.method === undefined)) {
          return jsonResponse([oldSignal]);
        }
        if (url.includes("binance.com")) return jsonResponse([{ symbol: "BTCUSDT", price: "104.00" }]); // entre break-even et TP2
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

    expect(closedPatch.outcome).toBe("WIN");
    expect(closedPatch.close_reason).toBe("tp_hit");
    expect(closedPatch.outcome_price).toBe(104);
  });

  it("bascule sur Kraken quand Binance est bloqué (HTTP 403 depuis Cloudflare)", async () => {
    // Cas réel observé en production le 03/08 : Binance refuse les IP
    // Cloudflare, et le suivi post-trade dépend entièrement du repli.
    const appels: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        appels.push(url);
        if (url.includes("signals") && url.includes("outcome=is.null")) return jsonResponse([recentSignal]);
        if (url.includes("binance.com")) return new Response("blocked", { status: 403 });
        if (url.includes("kraken.com")) {
          return jsonResponse({ error: [], result: { XBTUSDT: { c: ["104", "1"] } } });
        }
        if (url.includes("rest/v1/signals") && init?.method === "PATCH") return jsonResponse([{}]);
        return jsonResponse([]);
      })
    );

    await trackSignalOutcomes(env);

    expect(appels.some((u) => u.includes("binance.com"))).toBe(true);
    expect(appels.some((u) => u.includes("kraken.com"))).toBe(true);
    // Un seul appel Kraken : la requête est groupée, pas une par paire.
    expect(appels.filter((u) => u.includes("kraken.com")).length).toBe(1);
    // Kraken ayant répondu, Coinbase ne doit pas être sollicité du tout.
    expect(appels.some((u) => u.includes("exchange.coinbase.com"))).toBe(false);
  });

  it("échoue proprement (sans planter) si les trois sources de prix sont indisponibles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("signals") && url.includes("outcome=is.null")) return jsonResponse([recentSignal]);
        if (url.includes("binance.com") || url.includes("kraken.com") || url.includes("exchange.coinbase.com")) {
          return new Response("erreur", { status: 500 });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    // Aucune exception ne doit remonter : un signal sans prix reste ouvert et
    // sera réévalué au cycle suivant, ce qui vaut mieux qu'un cron qui plante.
    await expect(trackSignalOutcomes(env)).resolves.toBeUndefined();
  });
});
