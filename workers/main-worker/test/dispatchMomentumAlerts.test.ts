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
  TELEGRAM_VIP_CHANNEL_ID: "-100999",
} as any;

describe("dispatchMomentumAlerts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("poste chaque alerte non envoyée sur le canal VIP et la marque envoyée", async () => {
    const posted: { chatId: number; text: string }[] = [];
    let marked = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && url.includes("expiration=gt.")) {
          return jsonResponse([]);
        }
        if (url.includes("momentum_alerts") && url.includes("sent_at=gte.")) {
          return jsonResponse([]); // plafond quotidien (compté par date d'ENVOI réelle) : rien envoyé aujourd'hui, ne bloque pas ce test
        }
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
    // Canal VIP uniquement depuis le 02/08/2026 : ces alertes sont les
    // configurations ECARTEES par la strategie, non actionnables. Le canal
    // public recoit un bilan agrege a la place (dispatchSelectivityDigest).
    expect(posted[0].chatId).toBe(-100999);
    expect(posted[0].text).toContain("Alerte Momentum");
    expect(posted[0].text).toContain("PAS un signal de trading");
    expect(marked).toBe(true);
  });

  it("ne fait rien si le canal VIP n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchMomentumAlerts({ ...env, TELEGRAM_VIP_CHANNEL_ID: undefined });
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
        if (url.includes("/users") && url.includes("expiration=gt.")) {
          return jsonResponse([]);
        }
        if (url.includes("momentum_alerts") && url.includes("sent_at=gte.")) {
          return jsonResponse([]); // plafond quotidien (compté par date d'ENVOI réelle) : rien envoyé aujourd'hui, ne bloque pas ce test
        }
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

  it("respecte le plafond quotidien même pour un gros stock d'anciennes alertes en retard (bug du 30/07 : comptait par date de détection, pas d'envoi)", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      // Plafond quotidien déjà atteint (8 alertes envoyées AUJOURD'HUI, sent_at récent).
      if (url.includes("momentum_alerts") && url.includes("sent_at=gte.")) {
        return jsonResponse(Array.from({ length: 8 }, (_, i) => ({ id: 100 + i })));
      }
      // Un stock de 50 anciennes alertes non envoyées (created_at très ancien) ne doit
      // JAMAIS être interrogé une fois le plafond du jour atteint -- sinon régression.
      throw new Error(`Ne devrait pas être appelé une fois le plafond atteint: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await dispatchMomentumAlerts(env);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // seul le comptage du plafond -- retour immédiat, rien d'autre interrogé
  });
});
