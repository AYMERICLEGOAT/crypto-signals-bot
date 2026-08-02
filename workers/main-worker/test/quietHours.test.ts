import { describe, it, expect, vi, afterEach } from "vitest";
import { isQuietHours } from "../src/utils/quietHours";
import { dispatchCryptoFact } from "../src/cron/dispatchCryptoFact";
import { postChannelReminder } from "../src/cron/postChannelReminder";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

/** Retour utilisateur du 02/08/2026 : des messages partaient à 2 h du matin. */
describe("Heures calmes du canal public (23h-7h UTC)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("couvre toute la nuit, bornes comprises, et laisse la journée libre", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 7, 2, h, 30));
    // Nuit
    for (const h of [23, 0, 1, 2, 3, 4, 5, 6]) {
      expect(isQuietHours(at(h)), `${h}h UTC doit être silencieux`).toBe(true);
    }
    // Journée
    for (const h of [7, 8, 12, 18, 20, 22]) {
      expect(isQuietHours(at(h)), `${h}h UTC doit être autorisé`).toBe(false);
    }
  });

  it("bloque une anecdote à 2h du matin sans rien écrire en base", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 2, 0)));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await dispatchCryptoFact(env);

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("laisse passer la même anecdote à 10h", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 10, 0)));
    let posted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        // Les deux lectures visent crypto_facts : les distinguer par leur
        // filtre, sinon le gate "deja publiee aujourd'hui" repond oui.
        if (url.includes("crypto_facts") && url.includes("last_sent_at=gte")) {
          return jsonResponse([]); // rien publie aujourd'hui
        }
        if (url.includes("crypto_facts") && url.includes("order=")) {
          return jsonResponse([{ id: 1, content: "Une anecdote" }]);
        }
        if (url.includes("crypto_facts")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          posted = true;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await dispatchCryptoFact(env);
    expect(posted).toBe(true);
    vi.useRealTimers();
  });

  it("le rappel de canal est unique, fusionné, et muet la nuit", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 3, 0)));
    const nightSpy = vi.fn();
    vi.stubGlobal("fetch", nightSpy);
    await postChannelReminder(env);
    expect(nightSpy).not.toHaveBeenCalled();

    // De jour, un seul message contenant les deux informations autrefois
    // réparties entre postChannelReminder et dispatchChannelCta (supprimé).
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 12, 0)));
    let sent = "";
    let sendCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sendCount++;
          sent = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await postChannelReminder(env);
    expect(sendCount).toBe(1);
    expect(sent).toContain("temps réel");
    expect(sent).toContain("sécurisation automatique");
    expect(sent).toContain("/trial");
    vi.useRealTimers();
  });
});
