import { describe, it, expect, vi, afterEach } from "vitest";
import { revertLuckyVip } from "../src/cron/revertLuckyVip";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("revertLuckyVip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si aucun VIP n'est arrivé à échéance", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await revertLuckyVip(env);
  });

  it("restaure le plan précédent si le gagnant n'a jamais payé pour de vrai depuis", async () => {
    let revertedPlan: number | null = null;
    let markedReverted = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("lucky_vip_draws") && url.includes("reverted=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([{ id: 1, telegram_id: 42, granted_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-02T00:00:00Z", previous_plan: 0, reverted: false }]);
        }
        if (url.includes("telegram_id=eq.42") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, plan: 2, plan_started_at: null }]);
        }
        if (url.includes("users") && init?.method === "PATCH") {
          revertedPlan = JSON.parse(init.body as string).plan;
          return jsonResponse([]);
        }
        if (url.includes("lucky_vip_draws") && init?.method === "PATCH") {
          markedReverted = JSON.parse(init.body as string).reverted === true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await revertLuckyVip(env);

    expect(revertedPlan).toBe(0);
    expect(markedReverted).toBe(true);
  });

  it("ne rétrograde JAMAIS un utilisateur qui a payé pour de vrai depuis (plan_started_at posé)", async () => {
    let usersPatched = false;
    let markedReverted = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("lucky_vip_draws") && url.includes("reverted=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([{ id: 2, telegram_id: 43, granted_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-02T00:00:00Z", previous_plan: 0, reverted: false }]);
        }
        if (url.includes("telegram_id=eq.43") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 43, plan: 2, plan_started_at: "2026-01-01T12:00:00Z" }]); // a payé pour de vrai entre-temps
        }
        if (url.includes("users") && init?.method === "PATCH") {
          usersPatched = true;
          return jsonResponse([]);
        }
        if (url.includes("lucky_vip_draws") && init?.method === "PATCH") {
          markedReverted = JSON.parse(init.body as string).reverted === true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await revertLuckyVip(env);

    expect(usersPatched).toBe(false); // le plan Pro payé n'est jamais touché
    expect(markedReverted).toBe(true); // mais le tirage est bien clôturé pour ne pas être retraité
  });

  it("ne fait rien de plus si l'utilisateur n'a déjà plus le plan Pro (a changé de plan autrement)", async () => {
    let usersPatched = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("lucky_vip_draws") && url.includes("reverted=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([{ id: 3, telegram_id: 44, granted_at: "2026-01-01T00:00:00Z", expires_at: "2026-01-02T00:00:00Z", previous_plan: 0, reverted: false }]);
        }
        if (url.includes("telegram_id=eq.44") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 44, plan: 0, plan_started_at: null }]); // déjà retombé (expiration naturelle)
        }
        if (url.includes("users") && init?.method === "PATCH") {
          usersPatched = true;
          return jsonResponse([]);
        }
        if (url.includes("lucky_vip_draws") && init?.method === "PATCH") return jsonResponse([]);
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await revertLuckyVip(env);
    expect(usersPatched).toBe(false);
  });
});
