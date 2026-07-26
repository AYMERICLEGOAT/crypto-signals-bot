import { describe, it, expect, vi, afterEach } from "vitest";
import { handlePrefsCommand, handlePrefsToggle } from "../src/bot/commands/prefs";
import { dispatchMomentumAlerts } from "../src/cron/dispatchMomentumAlerts";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handlePrefsCommand", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("affiche tout activé par défaut si l'utilisateur n'a jamais touché à /prefs", async () => {
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

  it("désactive une préférence et le confirme", async () => {
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

    await handlePrefsToggle(env, 111, "prefs:momentum_alerts:off");
    expect(upserted.momentum_alerts).toBe(false);
    expect(confirmText).toContain("désactivé");
  });
});

describe("dispatchMomentumAlerts respecte les préférences (Bloc 19)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("n'envoie pas de DM à un abonné ayant désactivé les alertes momentum", async () => {
    const dmRecipients: number[] = [];
    const envWithChannel = { ...env, TELEGRAM_CHANNEL_ID: "-100123" };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("momentum_alerts") && url.includes("sent_to_channel=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([{ id: 1, pair: "BTC/USDT", kind: "atr_spike", detail: "Volatilité en hausse", created_at: "2026-01-01T00:00:00Z", sent_to_channel: false }]);
        }
        if (url.includes("/users") && url.includes("expiration=gt.")) {
          return jsonResponse([{ telegram_id: 111, plan: 2, expiration: "2099-01-01T00:00:00Z" }, { telegram_id: 222, plan: 2, expiration: "2099-01-01T00:00:00Z" }]);
        }
        if (url.includes("user_prefs") && url.includes("telegram_id=in.")) {
          return jsonResponse([{ telegram_id: 111, momentum_alerts: false, educational_posts: true, weekly_recap: true }]);
        }
        if (url.includes("momentum_alerts") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          const chatId = JSON.parse(init!.body as string).chat_id;
          if (chatId !== -100123) dmRecipients.push(chatId);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchMomentumAlerts(envWithChannel);
    expect(dmRecipients).toEqual([222]); // 111 a désactivé, 222 non (défaut = activé)
  });
});
