import { describe, it, expect, vi, afterEach } from "vitest";
import { revokeExpiredVip } from "../src/cron/revokeExpiredVip";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_VIP_CHANNEL_ID: "-100999",
} as any;

const EXPIRE = { telegram_id: 42, expiration: "2026-08-01T00:00:00Z" };

interface Options {
  expires?: unknown[];
  statut?: string | null;
  echecRetrait?: boolean;
}

function stub(opts: Options = {}) {
  const bannis: number[] = [];
  const debannis: number[] = [];
  const messages: { chatId: number; text: string }[] = [];
  const marques: unknown[] = [];
  let urlRequete = "";

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/users") && (!init || init.method === undefined)) {
        urlRequete = url;
        return jsonResponse(opts.expires ?? [EXPIRE]);
      }
      if (url.includes("/users") && init?.method === "PATCH") {
        marques.push(JSON.parse(init.body as string));
        return jsonResponse([]);
      }
      if (url.includes("getChatMember")) {
        return jsonResponse(opts.statut === null ? { ok: false } : { ok: true, result: { status: opts.statut ?? "member" } });
      }
      // L'ordre compte : "unbanChatMember" CONTIENT "banChatMember", donc le
      // débannissement doit être testé en premier sous peine d'être compté
      // comme un bannissement.
      if (url.includes("unbanChatMember")) {
        debannis.push(JSON.parse(init!.body as string).user_id);
        return jsonResponse({ ok: true });
      }
      if (url.includes("banChatMember")) {
        if (opts.echecRetrait) return new Response("forbidden", { status: 400 });
        bannis.push(JSON.parse(init!.body as string).user_id);
        return jsonResponse({ ok: true });
      }
      if (url.includes("sendMessage")) {
        const b = JSON.parse(init!.body as string);
        messages.push({ chatId: b.chat_id, text: b.text });
        return jsonResponse({ ok: true, result: {} });
      }
      return jsonResponse([]);
    })
  );
  return { bannis, debannis, messages, marques, urlRequete: () => urlRequete };
}

describe("Retrait du canal VIP à l'expiration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retire bien un abonné expiré du canal", async () => {
    // Le trou que cette tâche bouche : AUCUN mécanisme de retrait n'existait.
    // Quelqu'un qui payait 5 USDT pour 14 jours gardait l'accès VIP à vie, et
    // continuait de recevoir le briefing quotidien avec entrées et stops.
    const { bannis } = stub();
    await revokeExpiredVip(env);
    expect(bannis).toEqual([42]);
  });

  it("DÉBANNIT immédiatement après : un ancien abonné doit pouvoir revenir", async () => {
    // Telegram n'a pas d'« expulser » : banChatMember bloque aussi le retour.
    // Sans le débannissement, quelqu'un qui repaie ne pourrait plus jamais
    // rentrer, et personne ne comprendrait pourquoi.
    const { debannis } = stub();
    await revokeExpiredVip(env);
    expect(debannis).toEqual([42]);
  });

  it("prévient AVANT de retirer, et dit comment revenir", async () => {
    const { messages } = stub();
    await revokeExpiredVip(env);
    expect(messages).toHaveLength(1);
    expect(messages[0].chatId).toBe(42);
    expect(messages[0].text).toContain("/subscribe");
    // Le canal public reste ouvert : le dire évite de donner l'impression que
    // tout s'arrête.
    expect(messages[0].text).toMatch(/canal public/i);
  });

  it("ne touche JAMAIS un administrateur", async () => {
    const { bannis, marques } = stub({ statut: "administrator" });
    await revokeExpiredVip(env);
    expect(bannis).toHaveLength(0);
    // Marqué quand même, sinon il serait réexaminé à chaque passage.
    expect(marques).toHaveLength(1);
  });

  it("ne fait rien pour quelqu'un déjà parti, mais le marque", async () => {
    const { bannis, messages, marques } = stub({ statut: "left" });
    await revokeExpiredVip(env);
    expect(bannis).toHaveLength(0);
    expect(messages).toHaveLength(0);
    expect(marques).toHaveLength(1);
  });

  it("ne fait rien pour quelqu'un qui n'a jamais rejoint le canal", async () => {
    const { bannis, messages } = stub({ statut: null });
    await revokeExpiredVip(env);
    expect(bannis).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it("marque même quand le retrait échoue, pour ne pas boucler sur la même personne", async () => {
    const { marques } = stub({ echecRetrait: true });
    await revokeExpiredVip(env);
    expect(marques).toHaveLength(1);
    expect(marques[0]).toMatchObject({ vip_removed: true });
  });

  it("respecte un délai de grâce : personne n'est retiré à la seconde près", async () => {
    // Un paiement peut arriver quelques minutes après l'échéance, et le poller
    // ne tourne que toutes les cinq minutes. Expulser à la seconde ferait
    // sortir des gens qui viennent de renouveler.
    const s = stub();
    await revokeExpiredVip(env);
    const seuil = decodeURIComponent(s.urlRequete()).match(/expiration=lt\.([^&]+)/)?.[1];
    expect(seuil).toBeTruthy();
    expect(new Date(seuil!).getTime()).toBeLessThan(Date.now());
  });

  it("ne fait rien si aucun canal VIP n'est configuré", async () => {
    const { bannis } = stub();
    await revokeExpiredVip({ ...env, TELEGRAM_VIP_CHANNEL_ID: undefined } as any);
    expect(bannis).toHaveLength(0);
  });

  it("ne fait rien quand personne n'est expiré", async () => {
    const { bannis, messages } = stub({ expires: [] });
    await revokeExpiredVip(env);
    expect(bannis).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });
});

describe("Retrait VIP — protections supplémentaires", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne touche JAMAIS l'administrateur, même s'il est simple membre du canal", async () => {
    // Protégé par son identifiant et pas seulement par son rôle : rien ne
    // garantit qu'il soit administrateur du canal plutôt que simple membre, et
    // se faire expulser de son propre canal par son propre bot serait une façon
    // idiote de découvrir cette tâche.
    const bannis: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 777, expiration: "2026-08-01T00:00:00Z" }]);
        }
        if (url.includes("getChatMember")) return jsonResponse({ ok: true, result: { status: "member" } });
        if (url.includes("unbanChatMember")) return jsonResponse({ ok: true });
        if (url.includes("banChatMember")) {
          bannis.push(JSON.parse(init!.body as string).user_id);
          return jsonResponse({ ok: true });
        }
        return jsonResponse([]);
      })
    );

    await revokeExpiredVip({ ...env, ADMIN_TELEGRAM_ID: "777" } as any);
    expect(bannis).toHaveLength(0);
  });

  it("ne prétend pas que l'expiration vient d'avoir lieu", async () => {
    // Ce passage rattrape aussi des expirations anciennes : dater l'événement à
    // tort se remarque immédiatement chez quelqu'un qui a expiré il y a trois
    // semaines, et abîme la crédibilité de tout le reste.
    const { messages } = stub();
    await revokeExpiredVip(env);
    expect(messages[0].text).not.toMatch(/vient de/i);
    expect(messages[0].text).toMatch(/a expiré/i);
  });
});
