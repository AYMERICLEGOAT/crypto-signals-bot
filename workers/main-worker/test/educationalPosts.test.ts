import { describe, it, expect, vi, afterEach } from "vitest";
import { getNextEducationalPost, hasSentEducationalPostToday, markEducationalPostSent } from "../src/db/educationalPosts";
import { dispatchEducationalPost } from "../src/cron/dispatchEducationalPost";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const db = { url: "https://fake-supabase.test", key: "k" };

describe("getNextEducationalPost", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("demande le tri last_sent_at nulls-first (jamais envoyé en premier)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("order=last_sent_at.asc.nullsfirst");
        return jsonResponse([{ id: 5, content: "Post", category: "EMA", last_sent_at: null }]);
      })
    );

    const post = await getNextEducationalPost(db);
    expect(post?.id).toBe(5);
  });

  it("retourne null si la table est vide", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    expect(await getNextEducationalPost(db)).toBeNull();
  });
});

describe("hasSentEducationalPostToday", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("true si un post a déjà été marqué envoyé aujourd'hui", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ id: 1 }])));
    expect(await hasSentEducationalPostToday(db)).toBe(true);
  });

  it("false si aucun post envoyé aujourd'hui", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    expect(await hasSentEducationalPostToday(db)).toBe(false);
  });
});

describe("dispatchEducationalPost", () => {
  afterEach(() => vi.unstubAllGlobals());

  const env = { TELEGRAM_BOT_TOKEN: "fake-token", TELEGRAM_CHANNEL_ID: "-100123", SUPABASE_URL: db.url, SUPABASE_KEY: db.key } as any;

  it("envoie le prochain post et le marque comme envoyé si aucun post n'est encore parti aujourd'hui", async () => {
    let markedSent = false;
    let sentToTelegram = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("educational_posts") && (!init || init.method === undefined)) {
          // Le premier appel GET (hasSentEducationalPostToday) filtre par last_sent_at=gte...
          if (url.includes("last_sent_at=gte.")) return jsonResponse([]);
          // Le second appel GET (getNextEducationalPost) trie par last_sent_at
          return jsonResponse([{ id: 7, content: "Contenu pédagogique", category: "RSI", last_sent_at: null }]);
        }
        if (url.includes("api.telegram.org")) {
          sentToTelegram = true;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("educational_posts") && init?.method === "PATCH") {
          markedSent = true;
          return jsonResponse([]);
        }
        if (url.includes("/users") && url.includes("expiration=gt.")) return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchEducationalPost(env);
    expect(sentToTelegram).toBe(true);
    expect(markedSent).toBe(true);
  });

  it("ne fait rien si un post a déjà été envoyé aujourd'hui", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("last_sent_at=gte.")) return jsonResponse([{ id: 1 }]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await dispatchEducationalPost(env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("ne fait rien si TELEGRAM_CHANNEL_ID n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await dispatchEducationalPost({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
