import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchMomentumAlerts } from "../src/cron/dispatchMomentumAlerts";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
} as any;

describe("dispatchMomentumAlerts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("poste chaque alerte non envoyée sur le canal public et la marque envoyée", async () => {
    const posted: { chatId: number; text: string }[] = [];
    let marked = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("momentum_alerts") && url.includes("sent_to_channel=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([
            { id: 7, pair: "BTC/USDT", kind: "rsi_neutral_exit", detail: "RSI sort de la zone neutre (74), dynamique haussière", created_at: "2026-01-01T00:00:00Z", sent_to_channel: false },
          ]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          posted.push({ chatId: body.chat_id, text: body.text });
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("momentum_alerts") && init?.method === "PATCH") {
          if (JSON.parse(init.body as string).sent_to_channel === true) marked = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchMomentumAlerts(env);

    expect(posted).toHaveLength(1);
    expect(posted[0].chatId).toBe(-100123456);
    expect(posted[0].text).toContain("Alerte Momentum");
    expect(posted[0].text).toContain("PAS un signal de trading");
    expect(marked).toBe(true);
  });

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchMomentumAlerts({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne fait rien si aucune alerte n'est en attente", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await dispatchMomentumAlerts(env);
  });

  it("continue avec les alertes suivantes si l'envoi de l'une d'elles échoue", async () => {
    let posted = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("momentum_alerts") && url.includes("sent_to_channel=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([
            { id: 1, pair: "BTC/USDT", kind: "atr_spike", detail: "Volatilité en hausse de 45% sur 4h", created_at: "2026-01-01T00:00:00Z", sent_to_channel: false },
            { id: 2, pair: "ETH/USDT", kind: "atr_spike", detail: "Volatilité en hausse de 60% sur 4h", created_at: "2026-01-01T00:05:00Z", sent_to_channel: false },
          ]);
        }
        if (url.includes("api.telegram.org")) {
          posted += 1;
          if (posted === 1) return new Response("erreur", { status: 500 });
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("momentum_alerts") && init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchMomentumAlerts(env);
    expect(posted).toBe(2);
  });
});
