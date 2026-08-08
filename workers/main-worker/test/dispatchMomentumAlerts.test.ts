import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { dispatchMomentumAlerts } from "../src/cron/dispatchMomentumAlerts";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123456",
  TELEGRAM_VIP_CHANNEL_ID: "-100999",
} as any;

const ALERTES = [
  { id: 7, pair: "BTC/USDT", kind: "rsi_neutral_exit", detail: "RSI sort de la zone neutre (74)", created_at: "2026-01-01T00:00:00Z", sent_to_channel: false },
  { id: 8, pair: "SOL/USDT", kind: "atr_spike", detail: "amplitude 3x sa moyenne", created_at: "2026-01-01T00:00:00Z", sent_to_channel: false },
  { id: 9, pair: "ADA/USDT", kind: "atr_spike", detail: "amplitude 2,4x sa moyenne", created_at: "2026-01-01T00:00:00Z", sent_to_channel: false },
];

/**
 * Le bilan ne part qu'à partir de 17 h UTC. Les tests figent donc l'horloge :
 * sans cela ils passeraient ou échoueraient selon l'heure d'exécution, ce qui
 * est la pire forme de test — il ne dit plus rien, et on finit par l'ignorer.
 */
function figerHeure(heureUtc: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(Date.UTC(2026, 7, 8, heureUtc, 30, 0)));
}

interface Options {
  alertes?: unknown[];
  dernierBilan?: string | null;
  postsDuJour?: unknown[];
}

function preparer(opts: Options = {}) {
  const envoyes: { chatId: number; text: string }[] = [];
  const marques: number[] = [];
  const journalises: unknown[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("system_heartbeats") && (!init || init.method === undefined)) {
        return jsonResponse(opts.dernierBilan ? [{ job_name: "momentum_digest_vip", last_run_at: opts.dernierBilan }] : []);
      }
      if (url.includes("system_heartbeats")) return jsonResponse([]);
      if (url.includes("channel_posts") && (!init || init.method === undefined)) {
        return jsonResponse(opts.postsDuJour ?? []);
      }
      if (url.includes("channel_posts")) {
        journalises.push(JSON.parse(init!.body as string));
        return jsonResponse([]);
      }
      if (url.includes("momentum_alerts") && url.includes("sent_to_channel=eq.false") && (!init || init.method === undefined)) {
        return jsonResponse(opts.alertes ?? ALERTES);
      }
      if (url.includes("momentum_alerts") && init?.method === "PATCH") {
        marques.push(1);
        return jsonResponse([]);
      }
      if (url.includes("api.telegram.org")) {
        const body = JSON.parse(init!.body as string);
        envoyes.push({ chatId: body.chat_id, text: body.text });
        return jsonResponse({ ok: true, result: {} });
      }
      return jsonResponse([]);
    })
  );

  return { envoyes, marques, journalises };
}

describe("Alertes momentum — UN bilan par jour, plus huit messages", () => {
  beforeEach(() => figerHeure(18));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("groupe toutes les alertes en UN SEUL message VIP", async () => {
    const { envoyes } = preparer();
    await dispatchMomentumAlerts(env);

    // Le point de tout ce module : trois alertes ne font plus trois messages.
    // Réduire le débit (30/jour, puis 8, puis 3 par cycle) n'avait jamais réglé
    // le problème, parce qu'une alerte non actionnable n'a aucune raison
    // d'arriver seule.
    expect(envoyes).toHaveLength(1);
    expect(envoyes[0].chatId).toBe(-100999);
    expect(envoyes[0].text).toContain("BTC/USDT");
    expect(envoyes[0].text).toContain("SOL/USDT");
    expect(envoyes[0].text).toContain("ADA/USDT");
  });

  it("dit explicitement qu'il n'y a rien à jouer là-dedans", async () => {
    const { envoyes } = preparer();
    await dispatchMomentumAlerts(env);
    // Sans cette phrase, un lecteur du canal VIP prendrait ces paires pour des
    // signaux — c'est justement la confusion qui rendait les alertes nuisibles.
    expect(envoyes[0].text).toMatch(/pas des trades/i);
    expect(envoyes[0].text).toMatch(/rien à jouer/i);
  });

  it("marque toutes les alertes du bilan comme envoyées", async () => {
    const { marques } = preparer();
    await dispatchMomentumAlerts(env);
    expect(marques).toHaveLength(3);
  });

  it("ne publie rien avant 17 h UTC : la journée n'a pas encore livré ses mouvements", async () => {
    figerHeure(9);
    const { envoyes } = preparer();
    await dispatchMomentumAlerts(env);
    expect(envoyes).toHaveLength(0);
  });

  it("ne publie qu'une fois par jour, même si le cron repasse", async () => {
    const { envoyes } = preparer({ dernierBilan: new Date(Date.UTC(2026, 7, 8, 17, 5, 0)).toISOString() });
    await dispatchMomentumAlerts(env);
    expect(envoyes).toHaveLength(0);
  });

  it("republie le lendemain : le bilan de la veille ne bloque pas celui du jour", async () => {
    const { envoyes } = preparer({ dernierBilan: new Date(Date.UTC(2026, 7, 7, 17, 5, 0)).toISOString() });
    await dispatchMomentumAlerts(env);
    expect(envoyes).toHaveLength(1);
  });

  it("ne publie rien quand aucune alerte n'attend", async () => {
    const { envoyes } = preparer({ alertes: [] });
    await dispatchMomentumAlerts(env);
    expect(envoyes).toHaveLength(0);
  });

  it("ne marque RIEN si l'envoi échoue : les alertes repartiront demain", async () => {
    const marques: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("channel_posts")) return jsonResponse([]);
        if (url.includes("momentum_alerts") && url.includes("sent_to_channel=eq.false")) return jsonResponse(ALERTES);
        if (url.includes("momentum_alerts") && init?.method === "PATCH") {
          marques.push(1);
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) throw new Error("Telegram indisponible");
        return jsonResponse([]);
      })
    );
    await dispatchMomentumAlerts(env);
    expect(marques).toHaveLength(0);
  });

  it("respecte le régulateur : rien ne part si le canal VIP vient de parler", async () => {
    const { envoyes } = preparer({
      postsDuJour: [{ categorie: "signal", sent_at: new Date(Date.UTC(2026, 7, 8, 18, 25, 0)).toISOString() }],
    });
    await dispatchMomentumAlerts(env);
    expect(envoyes).toHaveLength(0);
  });

  it("n'écrit JAMAIS sur le canal public", async () => {
    const { envoyes } = preparer();
    await dispatchMomentumAlerts(env);
    expect(envoyes.every((m) => m.chatId !== -100123456)).toBe(true);
  });
});
