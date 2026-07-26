import { describe, it, expect, vi, afterEach } from "vitest";
import { handleVipCommand } from "../src/bot/commands/vip";
import { rotateVipInviteLinkIfDue } from "../src/bot/vipChannel";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_VIP_CHANNEL_ID: "-100999",
} as any;

describe("handleVipCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuse un utilisateur sans abonnement payant actif", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, plan: 0, expiration: "2099-01-01T00:00:00Z" }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleVipCommand(env, 1);
    expect(sentText).toContain("/subscribe");
  });

  it("refuse un abonnement Standard expiré", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, plan: 1, expiration: "2020-01-01T00:00:00Z" }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleVipCommand(env, 1);
    expect(sentText).toContain("/subscribe");
  });

  it("envoie le lien existant à un abonné Pro actif sans en créer un nouveau", async () => {
    let sentText = "";
    let createCalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, plan: 2, expiration: "2099-01-01T00:00:00Z" }]);
        }
        if (url.includes("chain_state") && (!init || init.method === undefined)) {
          return jsonResponse([
            { key: "vip_invite_link", value: "https://t.me/+existing" },
            { key: "vip_invite_created_at", value: new Date().toISOString() },
          ]);
        }
        if (url.includes("createChatInviteLink")) {
          createCalled = true;
          return jsonResponse({ ok: true, result: { invite_link: "https://t.me/+new" } });
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleVipCommand(env, 1);
    expect(sentText).toContain("https://t.me/+existing");
    expect(createCalled).toBe(false);
  });

  it("crée un premier lien s'il n'en existe aucun encore", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, plan: 3, expiration: "2099-01-01T00:00:00Z" }]);
        }
        if (url.includes("chain_state") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("chain_state") && init?.method === "POST") return jsonResponse([{}]);
        if (url.includes("createChatInviteLink")) {
          return jsonResponse({ ok: true, result: { invite_link: "https://t.me/+brandnew" } });
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleVipCommand(env, 1);
    expect(sentText).toContain("https://t.me/+brandnew");
  });

  it("indique que le VIP n'est pas configuré si TELEGRAM_VIP_CHANNEL_ID est absent", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 1, plan: 1, expiration: "2099-01-01T00:00:00Z" }]);
        }
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleVipCommand({ ...env, TELEGRAM_VIP_CHANNEL_ID: undefined }, 1);
    expect(sentText).toContain("pas encore configuré");
  });
});

describe("rotateVipInviteLinkIfDue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait rien si le lien actuel a moins de 30 jours", async () => {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("chain_state") && (!init || init.method === undefined)) {
        return jsonResponse([
          { key: "vip_invite_link", value: "https://t.me/+recent" },
          { key: "vip_invite_created_at", value: new Date().toISOString() },
        ]);
      }
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await rotateVipInviteLinkIfDue(env);
  });

  it("révoque et remplace le lien s'il a plus de 30 jours", async () => {
    let revoked = false;
    let created = false;
    const oldCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("chain_state") && (!init || init.method === undefined)) {
          return jsonResponse([
            { key: "vip_invite_link", value: "https://t.me/+old" },
            { key: "vip_invite_created_at", value: oldCreatedAt },
          ]);
        }
        if (url.includes("chain_state") && init?.method === "POST") return jsonResponse([{}]);
        if (url.includes("createChatInviteLink")) {
          created = true;
          return jsonResponse({ ok: true, result: { invite_link: "https://t.me/+fresh" } });
        }
        if (url.includes("revokeChatInviteLink")) {
          revoked = true;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await rotateVipInviteLinkIfDue(env);
    expect(created).toBe(true);
    expect(revoked).toBe(true);
  });
});
