import { describe, it, expect, vi, afterEach } from "vitest";
import { monitorSignalsHeartbeat } from "../src/cron/monitorSignalsHeartbeat";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  ADMIN_TELEGRAM_ID: "999",
} as any;

describe("monitorSignalsHeartbeat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si aucun admin n'est configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await monitorSignalsHeartbeat({ ...env, ADMIN_TELEGRAM_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne fait rien si le heartbeat n'a jamais été enregistré (état initial, pas une panne)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await monitorSignalsHeartbeat(env);
  });

  it("ne fait rien si le heartbeat est récent", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("system_heartbeats")) {
        return jsonResponse([{ job_name: "signals", last_run_at: new Date().toISOString(), alerted: false }]);
      }
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);
    await monitorSignalsHeartbeat(env);
  });

  it("alerte l'admin une fois si le heartbeat est trop vieux, et marque alerted=true", async () => {
    let alertText = "";
    let markedAlerted = false;
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(); // il y a 5h

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) {
          return jsonResponse([{ job_name: "signals", last_run_at: staleTimestamp, alerted: false }]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          alertText = body.text;
          expect(body.chat_id).toBe(999);
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("system_heartbeats") && init?.method === "PATCH") {
          markedAlerted = JSON.parse(init.body as string).alerted === true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await monitorSignalsHeartbeat(env);

    expect(alertText).toContain("générateur de signaux");
    expect(alertText).toContain("5h");
    expect(markedAlerted).toBe(true);
  });

  it("redéclenche le workflow via l'API GitHub si GITHUB_ACTIONS_TOKEN est configuré", async () => {
    let dispatchCalled = false;
    let alertText = "";
    const staleTimestamp = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) {
          return jsonResponse([{ job_name: "signals", last_run_at: staleTimestamp, alerted: false }]);
        }
        if (url.includes("api.github.com") && url.includes("signals.yml/dispatches")) {
          dispatchCalled = true;
          expect(init?.headers).toMatchObject({ Authorization: "Bearer fake-gh-token" });
          return new Response(null, { status: 204 });
        }
        if (url.includes("api.telegram.org")) {
          alertText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("system_heartbeats") && init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await monitorSignalsHeartbeat({ ...env, GITHUB_ACTIONS_TOKEN: "fake-gh-token" });

    expect(dispatchCalled).toBe(true);
    expect(alertText).toContain("Relance automatique déclenchée");
  });

  it("ne ré-alerte pas si déjà alerté pour cette panne", async () => {
    const staleTimestamp = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString();
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("system_heartbeats")) {
        return jsonResponse([{ job_name: "signals", last_run_at: staleTimestamp, alerted: true }]);
      }
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await monitorSignalsHeartbeat(env);
  });
});
