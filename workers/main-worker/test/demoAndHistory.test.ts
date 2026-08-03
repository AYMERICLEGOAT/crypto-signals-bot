import { describe, it, expect, vi, afterEach } from "vitest";
import { handleDemoCommand } from "../src/bot/commands/demo";
import { handleHistoryCommand } from "../src/bot/commands/history";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleDemoCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  // La commande ne tire plus d'exemple de backtest_trades. Cette table est
  // remplie par l'ANCIEN moteur (achat sur RSI bas, objectif serré, ventes a
  // decouvert), desactive le 03/08/2026 apres avoir ete mesure comme la jambe
  // perdante. Afficher un de ces trades sous « voici ce que vous recevrez »
  // montrerait une geometrie et un sens de position que le nouveau moteur
  // n'emet jamais. Les tests suivants verifient donc la nouvelle intention :
  // decrire la FORME du signal, sans aucun appel a la base.
  function stubTelegramOnly() {
    let sentText = "";
    const appels: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        appels.push(url);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    return { texte: () => sentText, appels };
  }

  it("decrit la geometrie reelle du moteur Force Relative, sans interroger la base", async () => {
    const s = stubTelegramOnly();

    await handleDemoCommand(env, 42);

    expect(s.texte()).toContain("EXEMPLE");
    expect(s.texte()).toContain("ACHAT");
    // La geometrie mesuree par backtest_stop_impact, celle reellement emise.
    expect(s.texte()).toContain("4 x ATR");
    expect(s.texte()).toContain("7 jours");
    // Aucun appel a backtest_trades : plus aucun trade de l'ancien moteur
    // ne peut se glisser dans l'exemple.
    expect(s.appels.some((u) => u.includes("backtest_trades"))).toBe(false);
  });

  it("annonce la contrepartie avant l'abonnement, sans promettre de gain", async () => {
    const s = stubTelegramOnly();

    await handleDemoCommand(env, 42);
    const texte = s.texte();

    // Un prospect doit lire les trois contreparties AVANT de payer : la
    // majorite de perdants, le silence en marche baissier et sa duree.
    expect(texte).toContain("47,7 %");
    expect(texte).toContain("41 %");
    expect(texte).toContain("381 jours");
    expect(texte).toMatch(/majorité de perdants/i);
    expect(texte).toMatch(/pas une promesse|risque de perte/i);
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
