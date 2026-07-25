import { describe, it, expect, vi, afterEach } from "vitest";
import { sendWelcomeFollowUps } from "../src/cron/welcomeSequence";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("sendWelcomeFollowUps", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie la relance +1h et +1j aux utilisateurs éligibles, et marque chaque envoi séparément", async () => {
    const sentTexts: string[] = [];
    const marked: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("welcome_1h_sent=eq.false")) {
          return jsonResponse([{ telegram_id: 1, welcome_1h_sent: false }]);
        }
        if (url.includes("welcome_1d_sent=eq.false")) {
          return jsonResponse([{ telegram_id: 2, welcome_1d_sent: false }]);
        }
        if (url.includes("api.telegram.org")) {
          sentTexts.push(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.welcome_1h_sent === true) marked.push("1h");
          if (body.welcome_1d_sent === true) marked.push("1d");
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await sendWelcomeFollowUps(env);

    expect(sentTexts.some((t) => t.includes("/demo"))).toBe(true);
    expect(sentTexts.some((t) => t.includes("/referral"))).toBe(true);
    expect(marked).toEqual(["1h", "1d"]);
  });

  it("ne fait rien si personne n'est éligible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await sendWelcomeFollowUps(env);
  });
});
