import { describe, it, expect, vi, afterEach } from "vitest";
import { encodeReferralCode, decodeReferralCode } from "../src/bot/referral";
import { handleReferralCommand } from "../src/bot/commands/referral";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const commandEnv = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  // Nom réel en production : contient un underscore, voir le bug ci-dessous.
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

describe("encodeReferralCode / decodeReferralCode", () => {
  it("fait un aller-retour correct pour un telegram_id typique", () => {
    const telegramId = 987654321;
    const code = encodeReferralCode(telegramId);
    expect(decodeReferralCode(code)).toBe(telegramId);
  });

  it("produit un code court (base36) plutôt que l'ID brut", () => {
    const code = encodeReferralCode(987654321);
    expect(code.length).toBeLessThan(String(987654321).length);
  });

  it("rejette un code invalide (non numérique en base36 ou négatif)", () => {
    expect(decodeReferralCode("!!!")).toBeNull();
    expect(decodeReferralCode("-5")).toBeNull();
    expect(decodeReferralCode("")).toBeNull();
  });

  it("fonctionne pour plusieurs IDs distincts sans collision triviale", () => {
    const ids = [1, 42, 123456, 999999999];
    const codes = ids.map(encodeReferralCode);
    expect(new Set(codes).size).toBe(ids.length);
    ids.forEach((id, i) => expect(decodeReferralCode(codes[i])).toBe(id));
  });
});

describe("handleReferralCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie le lien de parrainage et la progression sans erreur Telegram", async () => {
    let sentPayload: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, paid_referral_count: 2 }]);
        }
        if (url.includes("referral_rewards")) return jsonResponse([{ commission_usd: "3.5" }]);
        if (url.includes("api.telegram.org")) {
          sentPayload = JSON.parse(init!.body as string);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleReferralCommand(commandEnv, 42);

    expect(sentPayload).not.toBeNull();
    expect(sentPayload.text).toContain("t.me/ProVIPSignals");
    expect(sentPayload.parse_mode).toBe("Markdown");
  });

  it("échappe le underscore de TELEGRAM_BOT_USERNAME dans le lien -- sinon Telegram rejette tout le message en Markdown (bug vécu le 29/07, même famille que /help)", async () => {
    let sentText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 42, paid_referral_count: 0 }]);
        }
        if (url.includes("referral_rewards")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sentText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleReferralCommand(commandEnv, 42);

    expect(sentText).toContain("ProVIPSignals\\_bot");
    // Parité des marqueurs Markdown : un nombre impair de "_"/"*" non échappés
    // fait échouer tout le sendMessage ("can't parse entities").
    const unescaped = sentText.replace(/\\[_*`[]/g, "");
    for (const marker of ["*", "_"]) {
      const count = unescaped.split(marker).length - 1;
      expect(count % 2).toBe(0);
    }
  });
});
