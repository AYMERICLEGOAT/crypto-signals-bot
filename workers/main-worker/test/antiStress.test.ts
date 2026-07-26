import { describe, it, expect, vi, afterEach } from "vitest";
import { handleAntiStress } from "../src/cron/antiStress";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleAntiStress (ÉTAPE 5)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie le message de réassurance exactement à la 2e perte consécutive, jamais avant ni après", async () => {
    let reassured = 0;
    let updatedCount: number | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && url.includes("telegram_id=in.")) {
          return jsonResponse([{ telegram_id: 42, plan: 2, consecutive_losses: 1 }]);
        }
        if (url.includes("/users") && init?.method === "PATCH") {
          updatedCount = JSON.parse(init.body as string).consecutive_losses;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          const text = JSON.parse(init!.body as string).text as string;
          if (text.includes("pertes consécutives")) reassured += 1;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleAntiStress(env, [42], "LOSS");

    expect(updatedCount).toBe(2);
    expect(reassured).toBe(1);
  });

  it("n'envoie rien à un utilisateur en essai gratuit (plan 0)", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/users") && url.includes("telegram_id=in.")) {
        return jsonResponse([{ telegram_id: 7, plan: 0, consecutive_losses: 1 }]);
      }
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await handleAntiStress(env, [7], "LOSS");
    // Un seul appel : la lecture des users. Aucune écriture, aucun message (exclu = pas payant).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("célèbre un take profit et remet le compteur à zéro pour un abonné payant", async () => {
    let celebrated = 0;
    let resetTo: number | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && url.includes("telegram_id=in.")) {
          return jsonResponse([{ telegram_id: 42, plan: 1, consecutive_losses: 2 }]);
        }
        if (url.includes("/users") && init?.method === "PATCH") {
          resetTo = JSON.parse(init.body as string).consecutive_losses;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          celebrated += 1;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleAntiStress(env, [42], "WIN");

    expect(resetTo).toBe(0);
    expect(celebrated).toBe(1);
  });

  it("ne fait rien si la liste de destinataires est vide", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await handleAntiStress(env, [], "LOSS");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
