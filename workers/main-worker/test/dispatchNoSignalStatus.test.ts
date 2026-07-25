import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchNoSignalStatus } from "../src/cron/dispatchNoSignalStatus";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
} as any;

describe("dispatchNoSignalStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchNoSignalStatus({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne poste rien si déjà posté aujourd'hui", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("no_signal_status_posts")) return jsonResponse([{ id: 1, posted_at: new Date().toISOString() }]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchNoSignalStatus(env);
  });

  it("ne poste rien si un vrai signal est déjà sorti dans les dernières 24h", async () => {
    let posted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("no_signal_status_posts") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("signals")) return jsonResponse([{ id: 1 }]);
        if (url.includes("api.telegram.org")) {
          posted = true;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchNoSignalStatus(env);
    expect(posted).toBe(false);
  });

  it("poste le statut honnête et enregistre le post si aucun signal depuis 24h", async () => {
    let postedText = "";
    let postedChatId: number | null = null;
    let recorded = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("no_signal_status_posts") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("signals") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          postedText = body.text;
          postedChatId = body.chat_id;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("no_signal_status_posts") && init?.method === "POST") {
          recorded = true;
          return jsonResponse([{}]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchNoSignalStatus(env);

    expect(postedChatId).toBe(-100123456);
    expect(postedText).toContain("Aucun signal généré aujourd'hui");
    expect(recorded).toBe(true);
  });
});
