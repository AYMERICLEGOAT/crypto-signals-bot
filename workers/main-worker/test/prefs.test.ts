import { describe, it, expect, vi, afterEach } from "vitest";
import { handlePrefsCommand, handlePrefsToggle } from "../src/bot/commands/prefs";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handlePrefsCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("affiche toutes les préférences activées par défaut (Étape 2 : sécurisation automatique incluse)", async () => {
    let keyboard: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("user_prefs")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          keyboard = JSON.parse(init!.body as string).reply_markup.inline_keyboard;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePrefsCommand(env, 111);
    const labels = keyboard.map((row: any) => row[0].text);
    expect(labels.every((l: string) => l.startsWith("✅"))).toBe(true);
  });
});

describe("handlePrefsToggle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("désactive le trailing stop et le confirme", async () => {
    let upserted: any;
    let confirmText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("user_prefs") && init?.method === "POST") {
          upserted = JSON.parse(init.body as string);
          return jsonResponse([upserted]);
        }
        if (url.includes("user_prefs")) return jsonResponse([upserted].filter(Boolean));
        if (url.includes("api.telegram.org")) {
          confirmText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePrefsToggle(env, 111, "prefs:trailing_stop:off");
    expect(upserted.trailing_stop).toBe(false);
    expect(confirmText).toContain("désactivé");
  });

  it("ignore silencieusement une clé qui n'est plus proposée (Alertes Momentum/éducatif/récap sont channel-only désormais)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await handlePrefsToggle(env, 111, "prefs:momentum_alerts:off");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("active le trailing stop pour un utilisateur qui l'avait désactivé", async () => {
    let upserted: any;
    let confirmText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("user_prefs") && init?.method === "POST") {
          upserted = JSON.parse(init.body as string);
          return jsonResponse([upserted]);
        }
        if (url.includes("user_prefs")) return jsonResponse([upserted].filter(Boolean));
        if (url.includes("api.telegram.org")) {
          confirmText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handlePrefsToggle(env, 111, "prefs:trailing_stop:on");
    expect(upserted.trailing_stop).toBe(true);
    expect(confirmText).toContain("activé");
  });
});
