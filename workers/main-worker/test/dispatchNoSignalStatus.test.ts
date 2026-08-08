import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { dispatchNoSignalStatus } from "../src/cron/dispatchNoSignalStatus";
import { PART_FILTRE_FERME } from "../src/publishedStats";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
} as any;

// Midi UTC : hors des heures calmes (23h-7h), sinon tout le module s'abstient.
const NOON_UTC = new Date("2026-08-03T12:00:00Z");

/**
 * Série journalière synthétique dont la dernière clôture est SOUS la moyenne
 * 200 jours : le marché monte longuement, puis rechute. La phase haussière
 * initiale sert à ce que la fermeture ait un début visible dans l'historique,
 * donc à ce que le compteur de jours de fermeture soit mesurable.
 */
function krakenCandlesBelowMa(now: Date) {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  const total = 300;
  return Array.from({ length: total }, (_, i) => {
    const close = i < 240 ? 100 + i : 340 - (i - 240) * 4;
    const time = midnight - (total - i) * 86_400;
    return [time, close, close, close, close, close, 1, 1];
  });
}

function stubDb(overrides: { alreadyPosted?: boolean; recentSignal?: boolean } = {}) {
  const state = { postedText: "", recorded: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("no_signal_status_posts") && init?.method === "POST") {
        state.recorded = true;
        return jsonResponse([{}]);
      }
      if (url.includes("no_signal_status_posts")) return jsonResponse(overrides.alreadyPosted ? [{ id: 1 }] : []);
      if (url.includes("signals")) return jsonResponse(overrides.recentSignal ? [{ id: 1 }] : []);
      if (url.includes("api.kraken.com")) {
        return jsonResponse({ result: { XXBTZUSD: krakenCandlesBelowMa(new Date()), last: 0 } });
      }
      if (url.includes("api.telegram.org")) {
        state.postedText = JSON.parse(init!.body as string).text;
        return jsonResponse({ ok: true, result: {} });
      }
      throw new Error(`URL inattendue: ${url}`);
    })
  );
  return state;
}

describe("dispatchNoSignalStatus (post « état du marché »)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    vi.setSystemTime(NOON_UTC);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchNoSignalStatus({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne poste rien pendant les heures calmes", async () => {
    vi.setSystemTime(new Date("2026-08-03T02:00:00Z"));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchNoSignalStatus(env);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne poste rien si déjà posté aujourd'hui", async () => {
    vi.setSystemTime(NOON_UTC);
    const state = stubDb({ alreadyPosted: true });
    await dispatchNoSignalStatus(env);
    expect(state.postedText).toBe("");
  });

  it("ne poste rien si un vrai signal est déjà sorti dans les dernières 24h", async () => {
    vi.setSystemTime(NOON_UTC);
    const state = stubDb({ recentSignal: true });
    await dispatchNoSignalStatus(env);
    expect(state.postedText).toBe("");
  });

  it("explique la fermeture du filtre quand le marché est vérifié sous sa moyenne 200 jours", async () => {
    vi.setSystemTime(NOON_UTC);
    const state = stubDb();

    await dispatchNoSignalStatus(env);

    expect(state.recorded).toBe(true);
    // La statistique de fermeture, présente dans toutes les variantes utiles.
    // Lue depuis publishedStats : une copie en dur ici avait figé « 41 % »
    // pendant que la mesure canonique passait à 42 %.
    expect(state.postedText).toContain(PART_FILTRE_FERME);
    expect(state.postedText).toContain("Pas un conseil en investissement");
  });

  it("n'affirme RIEN sur le marché quand les sources de prix sont indisponibles", async () => {
    vi.setSystemTime(NOON_UTC);
    let postedText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("no_signal_status_posts") && init?.method === "POST") return jsonResponse([{}]);
        if (url.includes("no_signal_status_posts")) return jsonResponse([]);
        if (url.includes("signals")) return jsonResponse([]);
        if (url.includes("api.kraken.com") || url.includes("api.exchange.coinbase.com")) {
          return new Response("boom", { status: 503 });
        }
        if (url.includes("api.telegram.org")) {
          postedText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchNoSignalStatus(env);

    // Le canal publie quand même (il ne doit pas rester muet), mais sans
    // décrire un état de marché qui n'a pas pu être mesuré.
    expect(postedText).not.toBe("");
    expect(postedText).not.toContain("sous sa moyenne");
  });

  it("fait tourner les formulations et ne promet jamais de signal à venir", async () => {
    const textes: string[] = [];

    for (let day = 0; day < 10; day++) {
      vi.setSystemTime(new Date(NOON_UTC.getTime() + day * 86_400_000));
      const state = stubDb();
      await dispatchNoSignalStatus(env);
      textes.push(state.postedText);
      vi.unstubAllGlobals();
    }

    // Dix jours consécutifs, dix textes tous différents : c'est l'objet même du
    // module (un texte unique répété pendant une fermeture de plusieurs mois
    // devient du bruit, puis une raison de quitter le canal).
    expect(new Set(textes).size).toBe(10);

    // Garde-fou de non-régression : la version précédente se terminait par
    // « Reste connecté, le prochain signal arrivera dès qu'une vraie
    // opportunité se présente » — une promesse intenable alors que la plus
    // longue fermeture mesurée a duré 381 jours.
    for (const texte of textes) {
      expect(texte).not.toMatch(/prochain signal|reste connect|bient[oô]t|arrivera/i);
    }
  });
});
