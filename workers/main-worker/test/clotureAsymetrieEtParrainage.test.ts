import { describe, it, expect, vi, afterEach } from "vitest";
import { trackSignalOutcomes } from "../src/cron/trackSignalOutcomes";

/**
 * Deux comportements ajoutés à la clôture, et le second est surtout une
 * interdiction.
 *
 * 1. Le canal gratuit publiait déjà les niveaux d'origine, mais sans jamais
 *    dire QUAND les abonnés les avaient reçus. Le lecteur voyait des chiffres
 *    sans comprendre qu'il les découvrait avec plusieurs jours de retard —
 *    c'est-à-dire sans comprendre ce qu'il n'a pas.
 *
 * 2. Le bloc de parrainage n'était attaché qu'aux clôtures TP3, le cas le plus
 *    rare du produit. Il accompagne désormais TOUT gain — et JAMAIS une perte.
 *    Demander de partager un trade perdant serait absurde ; rappeler le bonus
 *    au pire moment se lirait comme de l'indécence.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
  TELEGRAM_CHANNEL_ID: "-100111",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
} as any;

/**
 * Signal ouvert depuis 3 jours, échéance dépassée -> clôture à l'échéance.
 *
 * Le prix des tests reste ENTRE l'entrée et TP1 : le moteur multi-TP n'avance
 * que d'un palier par passage, si bien qu'un prix franchissant TP1, TP2 et TP3
 * d'un coup marque seulement TP1 et sort de la boucle SANS clôturer. C'est le
 * comportement normal du produit, et il rendait ces tests muets.
 *
 * `tp1_hit_at` décide alors du résultat : déjà sécurisé -> gain, sinon perte.
 */
function signalExpire(over: Record<string, unknown> = {}) {
  const ilYA3Jours = new Date(Date.now() - 3 * 86_400_000).toISOString();
  return {
    id: 1,
    pair: "BTC/USDT",
    type: "BUY",
    entry_price: 100,
    stop_loss: 90,
    take_profit: 120,
    tp1_price: 110,
    tp2_price: 115,
    tp3_price: 120,
    tp1_hit_at: null,
    created_at: ilYA3Jours,
    hold_until: new Date(Date.now() - 60_000).toISOString(),
    sent_to_channel: true,
    outcome: null,
    ...over,
  };
}

interface Options {
  signal?: Record<string, unknown>;
  prix?: number;
}

function stub(opts: Options = {}) {
  const messages: { chatId: string; text: string }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        const b = JSON.parse(init!.body as string);
        messages.push({ chatId: String(b.chat_id), text: String(b.text ?? "") });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      if (url.includes("/signals") && (!init || init.method === undefined)) {
        return jsonResponse([opts.signal ?? signalExpire()]);
      }
      if (url.includes("signal_deliveries")) return jsonResponse([{ telegram_id: 42 }]);
      if (url.includes("channel_posts") && (!init || init.method === undefined)) return jsonResponse([]);
      if (url.includes("binance") || url.includes("kraken") || url.includes("coinbase")) {
        return jsonResponse([{ symbol: "BTCUSDT", price: String(opts.prix ?? 130) }]);
      }
      return jsonResponse([]);
    })
  );
  return { messages };
}

const canalPublic = (m: { chatId: string; text: string }[]) => m.filter((x) => x.chatId === "-100111");
const enPrive = (m: { chatId: string; text: string }[]) => m.filter((x) => x.chatId === "42");

describe("L'asymétrie est énoncée sur la clôture publique", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dit depuis combien de jours les abonnés avaient les niveaux", async () => {
    const { messages } = stub({ prix: 105 });
    await trackSignalOutcomes(env);
    const publics = canalPublic(messages);
    expect(publics.length).toBeGreaterThan(0);
    expect(publics[0].text).toMatch(/Les abonnés avaient ces niveaux il y a \d+ jour/);
  });

  it("compte les jours RÉELLEMENT écoulés, pas la durée prévue", async () => {
    // Un signal de 7 jours clôturé au 3e jour ne doit pas annoncer « 7 jours ».
    const { messages } = stub({
      signal: signalExpire({
        created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        hold_until: new Date(Date.now() - 60_000).toISOString(),
      }),
      prix: 105,
    });
    await trackSignalOutcomes(env);
    expect(canalPublic(messages)[0].text).toContain("il y a 3 jour(s)");
  });

  it("l'énonce aussi sur une clôture PERDANTE", async () => {
    // La différence de calendrier existe quel que soit le résultat, et le
    // canal gratuit doit la comprendre sur les pertes comme sur les gains.
    const { messages } = stub({ prix: 105 });
    await trackSignalOutcomes(env);
    const publics = canalPublic(messages);
    expect(publics[0].text).toMatch(/perdant/i);
    expect(publics[0].text).toMatch(/Les abonnés avaient ces niveaux/);
  });
});

describe("Le parrainage accompagne les gains, et JAMAIS les pertes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("est proposé sur un gain à l'échéance, pas seulement sur TP3", async () => {
    // C'était le défaut : seul TP3, le cas le plus rare, déclenchait le bloc.
    const { messages } = stub({ signal: signalExpire({ tp1_hit_at: new Date().toISOString() }), prix: 105 });
    await trackSignalOutcomes(env);
    const prives = enPrive(messages);
    expect(prives.length).toBeGreaterThan(0);
    expect(prives.some((m) => /À partager si tu veux/.test(m.text))).toBe(true);
  });

  it("N'EST JAMAIS proposé sur une perte", async () => {
    // Demander de partager un trade perdant serait absurde, et rappeler le
    // bonus au pire moment se lirait comme de l'indécence.
    const { messages } = stub({ prix: 105 });
    await trackSignalOutcomes(env);
    for (const m of enPrive(messages)) {
      expect(m.text).not.toMatch(/À partager si tu veux/);
      expect(m.text).not.toMatch(/filleul/i);
    }
  });

  it("ne fuite jamais dans le canal public : le lien est personnel", async () => {
    // buildReferralLink est propre à un telegram_id. Le publier sur un canal
    // attribuerait les filleuls de tout le monde à une seule personne.
    const { messages } = stub({ signal: signalExpire({ tp1_hit_at: new Date().toISOString() }), prix: 105 });
    await trackSignalOutcomes(env);
    for (const m of canalPublic(messages)) {
      expect(m.text).not.toMatch(/À partager si tu veux/);
    }
  });
});
