import { describe, it, expect, vi, afterEach } from "vitest";
import { handleDemoCommand } from "../src/bot/commands/demo";
import { handleHistoryCommand } from "../src/bot/commands/history";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleDemoCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("formate un exemple à partir d'un vrai trade du backtest, marqué comme exemple", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("backtest_trades")) {
          return jsonResponse([{
            id: 1, pair: "TRX/USDT", side: "SELL", entry_price: 0.2954, exit_price: 0.283584,
            outcome: "WIN", pnl_pct: 0.04, entered_at: "2026-01-26T09:00:00+00:00", exited_at: "2026-02-02T03:00:00+00:00",
          }]);
        }
        if (url.includes("strategy_params")) {
          return jsonResponse([{ win_rate: 0.3333, trade_count: 3, tp_pct: 0.04, sl_pct: 0.02 }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleDemoCommand(env, 42);
    expect(sentText).toContain("EXEMPLE");
    expect(sentText).toContain("TRX/USDT");
    expect(sentText).toContain("SELL");
  });

  it("répond proprement si aucun trade de backtest n'existe encore", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("backtest_trades")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleDemoCommand(env, 42);
    expect(sentText).toContain("Aucun exemple");
  });
});

describe("handleHistoryCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("affiche le statut et le P&L cumulé des signaux reçus", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("signal_deliveries")) {
          return jsonResponse([
            {
              delivered_at: "2026-07-20T10:00:00Z", tier: "standard",
              signals: { pair: "BTC/USDT", type: "BUY", entry_price: 60000, stop_loss: 58800, take_profit: 62400, outcome: "WIN", outcome_price: 62400, close_reason: "tp_hit" },
            },
            {
              delivered_at: "2026-07-18T10:00:00Z", tier: "standard",
              signals: { pair: "ETH/USDT", type: "SELL", entry_price: 3000, stop_loss: 3060, take_profit: 2880, outcome: null, outcome_price: null, close_reason: null },
            },
          ]);
        }
        if (url.includes("users")) return jsonResponse([{ telegram_id: 42, plan_started_at: null }]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleHistoryCommand(env, 42);
    expect(sentText).toContain("TP atteint");
    expect(sentText).toContain("En cours");
    expect(sentText).toContain("Cumul sur 1 signal");
  });

  it("répond proprement si aucun signal n'a encore été reçu", async () => {
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

    await handleHistoryCommand(env, 42);
    expect(sentText).toContain("Aucun signal reçu");
  });
});
