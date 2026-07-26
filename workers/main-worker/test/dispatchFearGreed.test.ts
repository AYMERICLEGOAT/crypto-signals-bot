import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchFearGreed } from "../src/cron/dispatchFearGreed";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", TELEGRAM_CHANNEL_ID: "-100123", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("dispatchFearGreed", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publie l'indice du jour et l'enregistre si pas encore fait aujourd'hui", async () => {
    let posted = "";
    let recorded: any = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("fear_greed_posts") && (!init || init.method === undefined)) {
          return jsonResponse([]); // pas encore publié aujourd'hui
        }
        if (url.includes("alternative.me")) {
          return jsonResponse({ data: [{ value: "72", value_classification: "Greed" }] });
        }
        if (url.includes("api.telegram.org")) {
          posted = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("fear_greed_posts") && init?.method === "POST") {
          recorded = JSON.parse(init.body as string);
          return jsonResponse([{}]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchFearGreed(env);
    expect(posted).toContain("72");
    expect(posted).toContain("Avidité");
    expect(posted).not.toMatch(/\d+%\s*de\s*chances/i);
    expect(recorded).toEqual({ value: 72, classification: "Greed" });
  });

  it("ne fait rien si déjà publié aujourd'hui", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse([{ id: 1 }]));
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchFearGreed(env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("n'échoue pas si l'API externe est indisponible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("fear_greed_posts")) return jsonResponse([]);
        if (url.includes("alternative.me")) return new Response("erreur", { status: 500 });
        throw new Error(`Ne devrait pas être appelé: ${url}`);
      })
    );
    await expect(dispatchFearGreed(env)).resolves.not.toThrow();
  });

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchFearGreed({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
