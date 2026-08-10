import { describe, it, expect, vi, afterEach } from "vitest";
import { sendPhotoWithText, CAPTION_MAX } from "../src/telegram";
import { dispatchSignals } from "../src/cron/dispatchSignals";

/**
 * LE BUG QUI A FAIT QUE PERSONNE N'A JAMAIS REÇU DE SIGNAL.
 *
 * Un message de signal complet fait environ 1400 caractères. La légende d'une
 * photo Telegram s'arrête à 1024, et l'API REFUSE au-delà — elle ne tronque
 * pas. Trois diffuseurs envoyaient le message entier en légende.
 *
 * Le plus grave était dispatchSignals, qui sert les abonnés PAYANTS : l'échec
 * était attrapé par destinataire, la liste des livraisons restait vide, et le
 * signal était quand même marqué « envoyé ». Les quatre signaux des 9 et
 * 10/08/2026 portent donc `sent = true` et `livraisons = 0` : comptés comme
 * diffusés alors que personne ne les avait reçus.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const LONG = "x".repeat(1500);
const COURT = "y".repeat(100);

function stubTelegram() {
  const appels: { methode: string; corps: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const methode = url.split("/").pop() ?? "";
      appels.push({ methode, corps: JSON.parse((init?.body as string) ?? "{}") });
      return jsonResponse({ ok: true, result: { message_id: 1 } });
    })
  );
  return appels;
}

describe("sendPhotoWithText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("garde le texte en légende quand il tient", () => {
    expect(COURT.length).toBeLessThanOrEqual(CAPTION_MAX);
  });

  it("envoie une seule requête pour un texte court", async () => {
    const appels = stubTelegram();
    await sendPhotoWithText("t", 1, "http://img", COURT, { markdown: true });
    expect(appels).toHaveLength(1);
    expect(appels[0].methode).toBe("sendPhoto");
    expect(appels[0].corps.caption).toBe(COURT);
  });

  it("scinde en deux quand le texte dépasse la limite", async () => {
    const appels = stubTelegram();
    await sendPhotoWithText("t", 1, "http://img", LONG, { markdown: true });
    expect(appels.map((a) => a.methode)).toEqual(["sendPhoto", "sendMessage"]);
  });

  it("ne met JAMAIS un texte trop long en légende", async () => {
    // C'est l'assertion qui compte : c'est exactement ce que Telegram refusait.
    const appels = stubTelegram();
    await sendPhotoWithText("t", 1, "http://img", LONG, { markdown: true });
    expect(String(appels[0].corps.caption).length).toBeLessThanOrEqual(CAPTION_MAX);
  });

  it("ne tronque rien : le texte entier part dans le second message", async () => {
    const appels = stubTelegram();
    await sendPhotoWithText("t", 1, "http://img", LONG, { markdown: true });
    expect(appels[1].corps.text).toBe(LONG);
  });

  it("la légende courte ne porte pas de parse_mode", async () => {
    // Elle est construite par ce module, pas par l'appelant, mais un Markdown
    // mal apparié dans une paire ferait rejeter le message ENTIER.
    const appels = stubTelegram();
    await sendPhotoWithText("t", 1, "http://img", LONG, { markdown: true });
    expect(appels[0].corps.parse_mode).toBeUndefined();
  });
});

describe("dispatchSignals — un signal avec graphique atteint vraiment l'abonné", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enregistre la livraison au lieu de la perdre en silence", async () => {
    // Le symptôme observé en production : sent = true, livraisons = 0.
    let livraisons: unknown[] | null = null;
    const envois: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          envois.push(url.split("/").pop() ?? "");
          return jsonResponse({ ok: true, result: { message_id: 1 } });
        }
        if (url.includes("signal_deliveries") && init?.method === "POST") {
          livraisons = JSON.parse(init.body as string);
          return jsonResponse([]);
        }
        if (url.includes("/signals") && (!init || init.method === undefined)) {
          return jsonResponse([
            {
              id: 7,
              pair: "SOL/USDT",
              type: "BUY",
              entry_price: 100,
              stop_loss: 94,
              take_profit: 112,
              tp1_price: 106,
              tp2_price: 112,
              tp3_price: 118,
              created_at: new Date().toISOString(),
              engine: "momentum_4h",
              hold_until: new Date(Date.now() + 3 * 86_400_000).toISOString(),
              chart_url: "https://exemple.test/chart.png",
              sent: false,
            },
          ]);
        }
        if (url.includes("/users")) {
          return jsonResponse([{ telegram_id: 8647576528, plan: 4, expiration: "2126-01-01T00:00:00Z" }]);
        }
        return jsonResponse([]);
      })
    );

    await dispatchSignals({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
      SUPABASE_URL: "https://fake.test",
      SUPABASE_KEY: "k",
    } as never);

    expect(envois, "aucun envoi Telegram").not.toHaveLength(0);
    expect(livraisons, "livraison jamais enregistrée").not.toBeNull();
    expect(JSON.stringify(livraisons)).toContain("8647576528");
  });
});
