import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchSelectivityDigest } from "../src/cron/dispatchSelectivityDigest";
import { dispatchMomentumAlerts } from "../src/cron/dispatchMomentumAlerts";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100111",
  TELEGRAM_VIP_CHANNEL_ID: "-100222",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

/**
 * Les Alertes Momentum étaient les configurations ÉCARTÉES par la stratégie,
 * publiées une par une sur le canal public : non actionnables (le message le
 * disait lui-même), jusqu'à 8/jour contre ~2,5 vrais signaux. Elles sont
 * désormais agrégées en un bilan quotidien côté public, et réservées au VIP
 * en temps réel.
 */
describe("Bilan de sélectivité (remplace le flot d'alertes publiques)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubDigest(emitted: unknown[], rejected: unknown[], onSend: (chatId: string, text: string) => void) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("/signals")) return jsonResponse(emitted);
        if (url.includes("momentum_alerts")) return jsonResponse(rejected);
        if (url.includes("api.telegram.org")) {
          const b = JSON.parse(init!.body as string);
          onSend(String(b.chat_id), b.text);
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );
  }

  it("agrège les rejets en UN message et les présente comme de la sélectivité", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 19, 0)));
    const sent: { chat: string; text: string }[] = [];
    stubDigest(
      [{ id: 1 }, { id: 2 }],
      [
        { id: 10, pair: "SAND/USDT", detail: "RSI ne confirme pas encore" },
        { id: 11, pair: "INJ/USDT", detail: "RSI sort de la zone neutre" },
        { id: 12, pair: "OP/USDT", detail: "dynamique haussière" },
        { id: 13, pair: "UNI/USDT", detail: "dynamique haussière" },
      ],
      (chat, text) => sent.push({ chat, text })
    );

    await dispatchSelectivityDigest(env);

    expect(sent).toHaveLength(1); // un seul message, pas quatre
    expect(sent[0].chat).toBe("-100111");
    expect(sent[0].text).toContain("6 configuration(s) examinée(s)");
    expect(sent[0].text).toContain("2 signal(aux) émis");
    expect(sent[0].text).toContain("4 écartée(s)");
    expect(sent[0].text).toContain("SAND/USDT");
  });

  it("présente une journée sans signal comme un résultat, pas comme une panne", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 19, 0)));
    let text = "";
    stubDigest([], [{ id: 10, pair: "BTC/USDT", detail: "critères non réunis" }], (_c, t) => (text = t));

    await dispatchSelectivityDigest(env);
    expect(text).toContain("c'est un résultat, pas une panne");
  });

  it("ne publie rien si rien n'a été examiné", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 19, 0)));
    let sends = 0;
    stubDigest([], [], () => sends++);
    await dispatchSelectivityDigest(env);
    expect(sends).toBe(0);
  });

  it("ne publie pas avant l'heure du bilan", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 10, 0)));
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await dispatchSelectivityDigest(env);
    expect(spy).not.toHaveBeenCalled();
  });

  it("les alertes individuelles ne vont plus JAMAIS sur le canal public", async () => {
    // Le bilan momentum ne part qu'à partir de 17 h UTC (voir
    // dispatchMomentumAlerts.ts) : sans cette heure, le test vérifierait
    // simplement que rien ne part, ce qui ne prouverait rien.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 18, 0)));
    const chats: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("momentum_alerts") && url.includes("sent_at")) return jsonResponse([]);
        if (url.includes("momentum_alerts") && (!init || init.method === undefined)) {
          return jsonResponse([{ id: 1, pair: "BTC/USDT", detail: "d" }, { id: 2, pair: "ETH/USDT", detail: "d" }]);
        }
        if (url.includes("momentum_alerts")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          chats.push(String(JSON.parse(init!.body as string).chat_id));
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await dispatchMomentumAlerts(env);

    expect(chats.length).toBeGreaterThan(0);
    expect(chats.every((c) => c === "-100222")).toBe(true); // VIP uniquement
    expect(chats).not.toContain("-100111");
  });
});
