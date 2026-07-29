import { describe, it, expect, vi, afterEach } from "vitest";
import { checkSignalFreshness } from "../src/cron/checkSignalFreshness";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  ADMIN_TELEGRAM_ID: "999",
} as any;

describe("checkSignalFreshness (Audit#30 -- alerte 6h sans signal, distincte du heartbeat)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si aucun admin n'est configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await checkSignalFreshness({ ...env, ADMIN_TELEGRAM_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne fait rien si le heartbeat n'a jamais tourné (état initial, pas une panne)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await checkSignalFreshness(env);
  });

  it("ne fait rien si un signal a été généré récemment (état normal, même si peu fréquent)", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("system_heartbeats")) {
        return jsonResponse([{ job_name: "signals", last_run_at: new Date().toISOString(), alerted: false, no_signal_alerted: false }]);
      }
      if (url.includes("signals")) return jsonResponse([{ id: 1 }]); // hasRecentSignal -> true
      throw new Error(`URL inattendue: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    await checkSignalFreshness(env);
  });

  it("alerte l'admin une fois si aucun signal depuis plus de 6h, et marque no_signal_alerted=true", async () => {
    let alertText = "";
    let marked = false;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("system_heartbeats") && (!init || init.method === undefined)) {
        return jsonResponse([{ job_name: "signals", last_run_at: new Date().toISOString(), alerted: false, no_signal_alerted: false }]);
      }
      if (url.includes("api.telegram.org")) {
        alertText = JSON.parse(init!.body as string).text;
        return jsonResponse({ ok: true, result: {} });
      }
      if (url.includes("system_heartbeats") && init?.method === "PATCH") {
        marked = JSON.parse(init.body as string).no_signal_alerted === true;
        return jsonResponse([]);
      }
      if (url.includes("signals")) return jsonResponse([]); // hasRecentSignal -> false
      throw new Error(`URL inattendue: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await checkSignalFreshness(env);

    expect(alertText).toContain("6h");
    expect(marked).toBe(true);
  });

  it("ne ré-alerte pas à chaque cycle tant que la panne sèche persiste (anti-spam)", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("system_heartbeats")) {
        return jsonResponse([{ job_name: "signals", last_run_at: new Date().toISOString(), alerted: false, no_signal_alerted: true }]);
      }
      if (url.includes("signals")) return jsonResponse([]);
      throw new Error(`URL inattendue: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    await checkSignalFreshness(env);
  });

  it("réinitialise no_signal_alerted dès qu'un nouveau signal revient", async () => {
    let cleared = false;
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("system_heartbeats") && (!init || init.method === undefined)) {
        return jsonResponse([{ job_name: "signals", last_run_at: new Date().toISOString(), alerted: false, no_signal_alerted: true }]);
      }
      if (url.includes("system_heartbeats") && init?.method === "PATCH") {
        cleared = JSON.parse(init.body as string).no_signal_alerted === false;
        return jsonResponse([]);
      }
      if (url.includes("signals")) return jsonResponse([{ id: 1 }]);
      throw new Error(`URL inattendue: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await checkSignalFreshness(env);

    expect(cleared).toBe(true);
  });
});
