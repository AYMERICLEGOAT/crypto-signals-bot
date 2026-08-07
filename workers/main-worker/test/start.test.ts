import { describe, it, expect, vi, afterEach } from "vitest";
import { handleStart } from "../src/bot/commands/start";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    telegram_id: 1,
    wallet_address: null,
    plan: null,
    expiration: null,
    trial_used: false,
    created_at: "2026-01-01T00:00:00Z",
    referred_by: null,
    ...overrides,
  };
}

describe("handleStart — séquence de 3 messages (refonte UX du 01/08/2026)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie 3 messages espacés (accroche, options, aide) avec le bouton essai sur chacun quand éligible", async () => {
    const sentMessages: { text: string; keyboard?: unknown }[] = [];
    const sleepCalls: number[] = [];

    vi.stubGlobal(
      "setTimeout",
      vi.fn((fn: () => void, ms: number) => {
        sleepCalls.push(ms);
        fn();
        return 0 as unknown as NodeJS.Timeout;
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && url.includes("telegram_id=eq.1")) return jsonResponse([makeUser()]);
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          sentMessages.push({ text: body.text, keyboard: body.reply_markup });
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleStart(env, 1);

    expect(sentMessages).toHaveLength(3);
    // Refonte du 04/08/2026 : les trois messages répondent aux trois questions
    // d'un visiteur, dans l'ordre — ce qu'il reçoit, pourquoi c'est différent,
    // comment essayer. L'ancienne séquence ouvrait sur le filtre de tendance,
    // c'est-à-dire sur ce que le bot NE fait pas.
    expect(sentMessages[0].text).toMatch(/signaux d'achat crypto/i);
    // Le carry est le meilleur argument du produit : il a son message dédié.
    expect(sentMessages[1].text).toContain("84,2 %");
    expect(sentMessages[1].text).toMatch(/carry/i);
    expect(sentMessages[2].text).toContain("/help");

    // Bouton "essai gratuit" présent sur chacun des 3 messages.
    for (const msg of sentMessages) {
      const flat = JSON.stringify(msg.keyboard);
      expect(flat).toContain("start:trial");
    }
    // Message 2 propose aussi /demo.
    expect(JSON.stringify(sentMessages[1].keyboard)).toContain("start:demo");
    // Message 3 propose aussi /help en bouton.
    expect(JSON.stringify(sentMessages[2].keyboard)).toContain("start:help");

    // Délais cumulés : +3s puis +7s (soit +10s au total depuis le message 1).
    expect(sleepCalls).toEqual([3_000, 7_000]);

    // Le premier message doit se lire en CINQ SECONDES. Il faisait
    // 1 500 caractères : tout y était vrai, mais un premier écran qui demande
    // une minute de lecture n'est pas lu, il est balayé. Le plafond est ici
    // pour que personne ne le regonfle sans s'en apercevoir.
    expect(sentMessages[0].text.length).toBeLessThan(400);
    // Et il annonce la contrainte du produit dès cet écran : c'est l'argument,
    // pas une précaution juridique.
    expect(sentMessages[0].text).toMatch(/on se tait/i);
    // Le premier écran propose l'action qui ne demande RIEN.
    expect(JSON.stringify(sentMessages[0].keyboard)).toContain("start:demo");

    // Le parrainage arrive au troisième message et pas avant : proposé au
    // premier écran, il demanderait de recommander un produit qu'on n'a pas
    // encore regardé.
    expect(sentMessages[2].text).toContain("/referral");
    expect(JSON.stringify(sentMessages[2].keyboard)).toContain("start:referral");
    expect(JSON.stringify(sentMessages[0].keyboard)).not.toContain("start:referral");

    // La phrase qui décide de tout reste en dernier, jamais retirée.
    expect(sentMessages[2].text).toContain("0,69 %");
  });

  it("n'affiche pas le bouton essai gratuit pour un abonné avec un plan payant déjà actif", async () => {
    vi.stubGlobal("setTimeout", vi.fn((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }));
    const sentMessages: { text: string; keyboard?: unknown }[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && url.includes("telegram_id=eq.2")) {
          return jsonResponse([makeUser({ telegram_id: 2, plan: 1, expiration: "2099-01-01T00:00:00.000Z" })]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          sentMessages.push({ text: body.text, keyboard: body.reply_markup });
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleStart(env, 2);

    expect(sentMessages).toHaveLength(3);
    for (const msg of sentMessages) {
      expect(JSON.stringify(msg.keyboard) ?? "").not.toContain("start:trial");
    }
    // Le message 1 garde son bouton /demo même pour un abonné payant : voir
    // un vrai signal ne demande rien et reste utile à tout le monde. Seul le
    // bouton d'essai disparaît, ce que vérifie la boucle ci-dessus.
    expect(JSON.stringify(sentMessages[0].keyboard)).toContain("start:demo");
    // Le message 2 garde /demo malgré tout.
    expect(JSON.stringify(sentMessages[1].keyboard)).toContain("start:demo");
  });

  it("attribue le parrainage avant d'envoyer les messages, si un payload de /start est fourni", async () => {
    vi.stubGlobal("setTimeout", vi.fn((fn: () => void) => { fn(); return 0 as unknown as NodeJS.Timeout; }));
    let referredByPatched = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("telegram_id=eq.3") && isGet) return jsonResponse([makeUser({ telegram_id: 3, referred_by: null })]);
        if (url.includes("telegram_id=eq.9") && isGet) return jsonResponse([makeUser({ telegram_id: 9 })]);
        if (url.includes("telegram_id=eq.3") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.referred_by === 9) referredByPatched = true;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );

    await handleStart(env, 3, "9"); // payload = code de parrainage du telegram_id 9 (voir referral.ts::decodeReferralCode)

    expect(referredByPatched).toBe(true);
  });
});
