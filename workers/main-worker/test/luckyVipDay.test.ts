import { describe, it, expect, vi, afterEach } from "vitest";
import { runLuckyVipDay } from "../src/cron/luckyVipDay";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("runLuckyVipDay", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si un tirage a déjà eu lieu aujourd'hui", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("lucky_vip_draws") && url.includes("granted_at=gte.")) return jsonResponse([{ id: 1 }]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await runLuckyVipDay(env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien si aucun utilisateur n'est en essai actif", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("granted_at=gte.")) return jsonResponse([]);
        if (url.includes("users") && url.includes("plan=eq.0")) return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await runLuckyVipDay(env);
  });

  it("tire un gagnant, l'upgrade en Plan 2, enregistre le tirage et le notifie", async () => {
    const futureExpiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(); // essai encore valide 2 jours
    let planUpdated = false;
    let drawRecorded = false;
    let notified = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("granted_at=gte.")) return jsonResponse([]);
        if (url.includes("users") && url.includes("plan=eq.0") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, plan: 0, expiration: futureExpiration, trial_used: true }]);
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(body.plan).toBe(2);
          expect(body.vip_until).toBeTruthy();
          planUpdated = true;
          return jsonResponse([]);
        }
        if (url.includes("lucky_vip_draws") && init?.method === "POST") {
          const body = JSON.parse(init.body as string);
          expect(body.telegram_id).toBe(42);
          drawRecorded = true;
          return jsonResponse([{ id: 1 }]);
        }
        if (url.includes("api.telegram.org")) {
          notified = true;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await runLuckyVipDay(env);
    expect(planUpdated).toBe(true);
    expect(drawRecorded).toBe(true);
    expect(notified).toBe(true);
  });

  it("ne raccourcit jamais l'expiration existante si elle dépasse déjà +24h", async () => {
    const farExpiration = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("granted_at=gte.")) return jsonResponse([]);
        if (url.includes("users") && url.includes("plan=eq.0") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 99, plan: 0, expiration: farExpiration, trial_used: true }]);
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          expect(new Date(body.expiration).getTime()).toBe(new Date(farExpiration).getTime());
          return jsonResponse([]);
        }
        if (url.includes("lucky_vip_draws") && init?.method === "POST") return jsonResponse([{ id: 1 }]);
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await runLuckyVipDay(env);
  });
});
