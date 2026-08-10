import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchVipBriefing } from "../src/cron/dispatchVipBriefing";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100111",
  TELEGRAM_VIP_CHANNEL_ID: "-100222",
} as any;

/**
 * Le canal VIP ne recevait QUE des messages de célébration : quelqu'un qui
 * paie rejoignait un canal quasi vide. Ces deux mécanismes lui donnent un
 * contenu propre (02/08/2026).
 */
describe("Valeur du canal VIP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });


  it("le briefing VIP montre les positions ouvertes, sécurisées ET à risque", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 9, 0)));
    let sent = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("/signals") && url.includes("outcome=is.null")) {
          return jsonResponse([
            { id: 1, pair: "BTC/USDT", type: "BUY", entry_price: 100, stop_loss: 95, tp1_hit_at: "2026-08-02T05:00:00Z" },
            { id: 2, pair: "ETH/USDT", type: "SELL", entry_price: 200, stop_loss: 210, tp1_hit_at: null },
          ]);
        }
        if (url.includes("/signals")) {
          return jsonResponse([
            { id: 3, pair: "SOL/USDT", type: "BUY", entry_price: 100, outcome: "WIN", outcome_price: 110 },
            { id: 4, pair: "ADA/USDT", type: "BUY", entry_price: 100, outcome: "LOSS", outcome_price: 96 },
          ]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          expect(String(body.chat_id)).toBe("-100222"); // VIP uniquement
          sent = body.text;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await dispatchVipBriefing(env);

    expect(sent).toContain("Briefing VIP");
    expect(sent).toContain("Positions ouvertes : 2");
    expect(sent).toContain("1 sécurisée(s)");
    expect(sent).toContain("1 encore à risque");
    // Les pertes sont montrées comme les gains.
    expect(sent).toContain("1 gagnante(s)");
    expect(sent).toContain("1 perdante(s)");
    // Aucune prévision.
    expect(sent).toContain("pas une prévision");
  });

  it("ne publie aucun briefing la nuit", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 3, 0)));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchVipBriefing(env);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne publie rien si le canal VIP n'est pas configuré", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 9, 0)));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchVipBriefing({ ...env, TELEGRAM_VIP_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
