import { describe, it, expect, vi, afterEach } from "vitest";
import { getChatMemberStatus } from "../src/telegram";
import { countReferralsBy } from "../src/db/users";
import { isEligibleForTrial } from "../src/bot/commands/trial";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("getChatMemberStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retourne le statut si l'utilisateur a interagi avec le chat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("getChatMember");
        expect(url).toContain("chat_id=-1004450068761");
        expect(url).toContain("user_id=42");
        return jsonResponse({ ok: true, result: { status: "member" } });
      })
    );

    const status = await getChatMemberStatus("fake-token", "-1004450068761", 42);
    expect(status).toBe("member");
  });

  it("retourne null si Telegram répond ok:false (jamais interagi avec le chat)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ok: false, description: "Bad Request: user not found" })));

    const status = await getChatMemberStatus("fake-token", "-1004450068761", 999);
    expect(status).toBeNull();
  });
});

describe("countReferralsBy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("compte les filleuls attribués à ce parrain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("referred_by=eq.123");
        return jsonResponse([{ telegram_id: 1 }, { telegram_id: 2 }]);
      })
    );

    const count = await countReferralsBy({ url: "https://fake-supabase.test", key: "k" }, 123);
    expect(count).toBe(2);
  });

  it("retourne 0 si personne n'a été parrainé", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));

    const count = await countReferralsBy({ url: "https://fake-supabase.test", key: "k" }, 123);
    expect(count).toBe(0);
  });
});

describe("isEligibleForTrial — boucle virale du /trial", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const baseEnv = {
    TELEGRAM_BOT_TOKEN: "fake-token",
    TELEGRAM_CHANNEL_ID: "-1004450068761",
  } as any;
  const db = { url: "https://fake-supabase.test", key: "k" };

  it("éligible si membre du canal (même sans parrainage)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("getChatMember")) return jsonResponse({ ok: true, result: { status: "member" } });
        throw new Error(`Appel inattendu (le comptage de parrainage ne devrait pas être nécessaire): ${url}`);
      })
    );

    const eligible = await isEligibleForTrial(baseEnv, db, 42);
    expect(eligible).toBe(true);
  });

  it("éligible si a parrainé au moins une personne (même sans avoir rejoint le canal)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("getChatMember")) return jsonResponse({ ok: false });
        if (url.includes("referred_by=eq.")) return jsonResponse([{ telegram_id: 1 }]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const eligible = await isEligibleForTrial(baseEnv, db, 42);
    expect(eligible).toBe(true);
  });

  it("inéligible si ni membre du canal ni parrain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("getChatMember")) return jsonResponse({ ok: false });
        if (url.includes("referred_by=eq.")) return jsonResponse([]);
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    const eligible = await isEligibleForTrial(baseEnv, db, 42);
    expect(eligible).toBe(false);
  });
});
