import { describe, it, expect, vi, afterEach } from "vitest";
import { postLeaderboard } from "../src/cron/postLeaderboard";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
} as any;

describe("postLeaderboard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await postLeaderboard({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne poste rien si un leaderboard a déjà été posté cette semaine", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("leaderboard_posts")) return jsonResponse([{ id: 1, posted_at: new Date().toISOString() }]);
        throw new Error(`Ne devrait pas être appelé: ${url}`);
      })
    );
    await postLeaderboard(env);
  });

  it("ne poste rien (et ne consomme pas le créneau) si personne n'a parrainé cette semaine", async () => {
    let leaderboardPostCreated = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("leaderboard_posts") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("referral_rewards")) return jsonResponse([]);
        if (url.includes("leaderboard_posts") && init?.method === "POST") {
          leaderboardPostCreated = true;
          return jsonResponse([{}]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );
    await postLeaderboard(env);
    expect(leaderboardPostCreated).toBe(false);
  });

  it("poste le top 3 masqué et trié, puis enregistre le post", async () => {
    let publicText = "";
    let publicChatId: number | null = null;
    let leaderboardPostCreated = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("leaderboard_posts") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("referral_rewards")) {
          return jsonResponse([
            { referrer_telegram_id: 111111111 },
            { referrer_telegram_id: 111111111 },
            { referrer_telegram_id: 111111111 },
            { referrer_telegram_id: 222222222 },
            { referrer_telegram_id: 222222222 },
            { referrer_telegram_id: 333333333 },
          ]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          publicChatId = body.chat_id;
          publicText = body.text;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("leaderboard_posts") && init?.method === "POST") {
          leaderboardPostCreated = true;
          return jsonResponse([{}]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await postLeaderboard(env);

    expect(publicChatId).toBe(-100123456);
    expect(publicText).toContain("Top Parrains");
    expect(publicText).toContain("...1111 — 3 filleul(s)");
    expect(publicText).toContain("...2222 — 2 filleul(s)");
    expect(publicText).toContain("...3333 — 1 filleul(s)");
    expect(publicText).not.toContain("111111111"); // jamais l'ID complet
    expect(leaderboardPostCreated).toBe(true);
  });
});
