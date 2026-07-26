import { describe, it, expect, vi, afterEach } from "vitest";
import { buildPolygonRpcConfig } from "../src/blockchain/rpc";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  ADMIN_TELEGRAM_ID: "999",
  POLYGON_RPC_URL: "https://primary.test",
} as any;

async function flush() {
  // laisse la chaîne de promesses fire-and-forget de onFallback se dérouler.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

describe("buildPolygonRpcConfig — anti-spam de l'alerte de bascule (Bloc 15.1 corrigé)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie une alerte au premier échec, jamais commis en production observé auparavant", async () => {
    let alertsSent = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          alertsSent += 1;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("system_heartbeats") && init?.method === "POST") return jsonResponse([{}]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const rpc = buildPolygonRpcConfig(env);
    rpc.onFallback?.(new Error("boom"));
    await flush();

    expect(alertsSent).toBe(1);
  });

  it("n'envoie PAS de nouvelle alerte si la précédente date de moins d'1h (coeur du correctif)", async () => {
    let alertsSent = 0;
    const recentAlert = new Date(Date.now() - 5 * 60 * 1000).toISOString(); // il y a 5 minutes

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) {
          return jsonResponse([{ job_name: "polygon_rpc_fallback", last_run_at: recentAlert, alerted: true }]);
        }
        if (url.includes("api.telegram.org")) {
          alertsSent += 1;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`Ne devrait pas être appelé: ${url}`);
      })
    );

    const rpc = buildPolygonRpcConfig(env);
    rpc.onFallback?.(new Error("boom"));
    await flush();

    expect(alertsSent).toBe(0);
  });

  it("renvoie une alerte si la précédente date de plus d'1h (panne toujours en cours, rappel espacé)", async () => {
    let alertsSent = 0;
    const oldAlert = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // il y a 2h

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) {
          return jsonResponse([{ job_name: "polygon_rpc_fallback", last_run_at: oldAlert, alerted: true }]);
        }
        if (url.includes("api.telegram.org")) {
          alertsSent += 1;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("system_heartbeats") && init?.method === "POST") return jsonResponse([{}]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const rpc = buildPolygonRpcConfig(env);
    rpc.onFallback?.(new Error("boom"));
    await flush();

    expect(alertsSent).toBe(1);
  });
});
