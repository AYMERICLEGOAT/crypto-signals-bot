import { describe, it, expect, vi, afterEach } from "vitest";
import { monthlyRecap } from "../src/cron/monthlyRecap";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
} as any;

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    delivered_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
    tier: "standard",
    signals: {
      pair: "BTC/USDT", type: "BUY", entry_price: 100, stop_loss: 95, take_profit: 110,
      outcome: "WIN", outcome_price: 110, close_reason: "tp_hit", tp1_hit_at: "2026-07-20T00:00:00Z",
      ...(overrides.signals as object ?? {}),
    },
    ...overrides,
  };
}

/**
 * Le service envoyait beaucoup de messages « produit » mais aucun qui dise à
 * l'abonné où IL en est — or c'est ce qui décide d'un renouvellement.
 */
describe("Bilan mensuel personnalisé", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stub(users: unknown[], deliveries: unknown[], onSend: (id: number, t: string) => void) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("signal_deliveries")) return jsonResponse(deliveries);
        if (url.includes("/users")) return jsonResponse(users);
        if (url.includes("api.telegram.org")) {
          const b = JSON.parse(init!.body as string);
          onSend(b.chat_id, b.text);
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );
  }

  it("montre les pertes autant que les gains", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 11, 0))); // 1er du mois, 11h UTC
    let text = "";
    stub(
      [{ telegram_id: 42, cancelled: false, plan_started_at: "2026-01-01T00:00:00Z" }],
      [
        delivery(),
        delivery({ signals: { pair: "ETH/USDT", type: "BUY", entry_price: 100, stop_loss: 95, take_profit: 110, outcome: "LOSS", outcome_price: 94, close_reason: "sl_hit", tp1_hit_at: null } }),
      ],
      (_id, t) => (text = t)
    );

    await monthlyRecap(env);

    expect(text).toContain("Ton bilan du mois");
    expect(text).toContain("2 signal(aux) reçu(s)");
    expect(text).toContain("1 gagnant(s)");
    expect(text).toContain("1 perdant(s)"); // la perte est bien affichée
    expect(text).toContain("1 sécurisé(s)");
    // Rappel que le résultat réel dépend de la taille de position engagée.
    expect(text).toContain("taille que TU as engagée");
  });

  it("ne dérange pas un abonné qui n'a rien reçu ce mois-ci", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 11, 0)));
    let sends = 0;
    stub([{ telegram_id: 42, cancelled: false }], [], () => sends++);
    await monthlyRecap(env);
    expect(sends).toBe(0);
  });

  it("ignore les signaux plus anciens qu'un mois", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 11, 0)));
    let sends = 0;
    stub(
      [{ telegram_id: 42, cancelled: false }],
      [delivery({ delivered_at: new Date(Date.now() - 90 * 86_400_000).toISOString() })],
      () => sends++
    );
    await monthlyRecap(env);
    expect(sends).toBe(0);
  });

  it("respecte /cancel", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 1, 11, 0)));
    let sends = 0;
    stub([{ telegram_id: 42, cancelled: true }], [delivery()], () => sends++);
    await monthlyRecap(env);
    expect(sends).toBe(0);
  });

  it("n'envoie rien un autre jour que le 1er", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 15, 11, 0)));
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await monthlyRecap(env);
    expect(spy).not.toHaveBeenCalled();
  });
});
