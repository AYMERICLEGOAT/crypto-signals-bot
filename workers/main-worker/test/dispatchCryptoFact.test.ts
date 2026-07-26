import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchCryptoFact } from "../src/cron/dispatchCryptoFact";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", TELEGRAM_CHANNEL_ID: "-100123", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("dispatchCryptoFact", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publie la prochaine anecdote et la marque envoyée si aucune n'est encore partie aujourd'hui", async () => {
    let posted = "";
    let marked = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("crypto_facts") && (!init || init.method === undefined)) {
          if (url.includes("last_sent_at=gte.")) return jsonResponse([]);
          return jsonResponse([{ id: 3, content: "Le bloc genesis contient un message caché.", last_sent_at: null }]);
        }
        if (url.includes("api.telegram.org")) {
          posted = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("crypto_facts") && init?.method === "PATCH") {
          marked = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchCryptoFact(env);
    expect(posted).toContain("Le saviez-vous");
    expect(posted).toContain("message caché");
    expect(marked).toBe(true);
  });

  it("ne fait rien si une anecdote a déjà été envoyée aujourd'hui", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("last_sent_at=gte.")) return jsonResponse([{ id: 1 }]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await dispatchCryptoFact(env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchCryptoFact({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
