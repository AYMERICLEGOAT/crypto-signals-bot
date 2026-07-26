import { describe, it, expect, vi, afterEach } from "vitest";
import { onPaymentConfirmed } from "../src/cron/pollPayments";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token" } as any;
const db = { url: "https://fake-supabase.test", key: "k" };

describe("onPaymentConfirmed — Bloc 14.3 (mois offert aux 10 premiers Standard)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prolonge l'abonnement de 30 jours et notifie si des places early-adopter restent", async () => {
    let patchedExpiration: string | null = null;
    let notified = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("offer_counter") && url.includes("early_adopter") && (!init || init.method === undefined)) {
          return jsonResponse([{ offer_name: "early_adopter", slots_total: 10, slots_used: 3 }]);
        }
        if (url.includes("offer_counter") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, expiration: "2026-01-01T00:00:00.000Z" }]);
        }
        if (url.includes("users") && init?.method === "PATCH") {
          patchedExpiration = JSON.parse(init.body as string).expiration;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          notified = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await onPaymentConfirmed(env, db, 42, 1); // STANDARD_PLAN = 1

    expect(patchedExpiration).toBe(new Date("2026-01-31T00:00:00.000Z").toISOString());
    expect(notified).toContain("10 premiers abonnés Standard");
  });

  it("ne fait rien si les 10 places early-adopter sont déjà prises", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("offer_counter")) return jsonResponse([{ offer_name: "early_adopter", slots_total: 10, slots_used: 10 }]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await onPaymentConfirmed(env, db, 42, 1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
