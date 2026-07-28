import { describe, it, expect, vi, afterEach } from "vitest";
import { handleMyPerformanceCommand } from "../src/bot/commands/myPerformance";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleMyPerformanceCommand (Bloc 17)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calcule le bilan à partir de tous les signaux reçus (pas seulement les 5 derniers)", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) {
          return jsonResponse([
            { delivered_at: "2026-01-01", tier: "pro", signals: { pair: "BTC/USDT", type: "BUY", entry_price: 100, stop_loss: 95, take_profit: 110, outcome: "WIN", outcome_price: 110, close_reason: "tp_hit" } },
            { delivered_at: "2026-01-02", tier: "pro", signals: { pair: "ETH/USDT", type: "BUY", entry_price: 50, stop_loss: 47.5, take_profit: 55, outcome: "LOSS", outcome_price: 47.5, close_reason: "sl_hit" } },
            { delivered_at: "2026-01-03", tier: "pro", signals: { pair: "SOL/USDT", type: "BUY", entry_price: 20, stop_loss: 19, take_profit: 22, outcome: null, outcome_price: null, close_reason: null } },
          ]);
        }
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, plan_started_at: null }]);
        }
        if (url.includes("referral_rewards")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleMyPerformanceCommand(env, 1);

    expect(sentText).toContain("Signaux reçus : 3");
    expect(sentText).toContain("Take profit : 1");
    expect(sentText).toContain("Stop loss : 1");
    expect(sentText).toContain("En cours : 1");
    expect(sentText).toContain("50%"); // 1 TP sur 2 clôturés
  });

  it("Étape 2 : affiche le compteur de trades sécurisés (TP1 atteint) en haut du résumé", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signal_deliveries") && (!init || init.method === undefined)) {
          return jsonResponse([
            {
              delivered_at: "2026-01-01",
              tier: "pro",
              signals: { pair: "BTC/USDT", type: "BUY", entry_price: 100, stop_loss: 100, take_profit: 133, outcome: "WIN", outcome_price: 133, close_reason: "tp_hit", tp1_hit_at: "2026-01-01T12:00:00Z" },
            },
            {
              delivered_at: "2026-01-02",
              tier: "pro",
              signals: { pair: "ETH/USDT", type: "BUY", entry_price: 50, stop_loss: 47.5, take_profit: 55, outcome: "LOSS", outcome_price: 47.5, close_reason: "sl_hit", tp1_hit_at: null },
            },
          ]);
        }
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, plan_started_at: null }]);
        }
        if (url.includes("referral_rewards")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleMyPerformanceCommand(env, 1);
    expect(sentText).toContain("🔒 Trades sécurisés");
    expect(sentText).toContain("1/2");
  });

  it("indique qu'aucun signal n'a été reçu si la liste est vide", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signal_deliveries")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleMyPerformanceCommand(env, 2);
    expect(sentText).toContain("Aucun signal reçu");
  });
});
