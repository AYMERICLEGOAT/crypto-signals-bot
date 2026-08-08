import { describe, it, expect, vi, afterEach } from "vitest";
import { sendTrialMidpointRecap } from "../src/cron/trialMidpointRecap";
import { PART_FILTRE_FERME } from "../src/publishedStats";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
} as any;

/** Essai à mi-parcours : il reste ~48 h sur 72. */
function essai(heuresRestantes = 48) {
  return {
    telegram_id: 42,
    plan: 0,
    expiration: new Date(Date.now() + heuresRestantes * 3_600_000).toISOString(),
  };
}

const SIGNAL_GAGNANT = {
  signals: { pair: "BTC/USDT", type: "BUY", entry_price: 100, outcome: "WIN", outcome_price: 110, engine: "cassure_canal" },
};
const SIGNAL_PERDANT = {
  signals: { pair: "ETH/USDT", type: "BUY", entry_price: 100, outcome: "LOSS", outcome_price: 92, engine: "relative_strength" },
};
const SIGNAL_OUVERT = {
  signals: { pair: "SOL/USDT", type: "BUY", entry_price: 100, outcome: null, outcome_price: null, engine: "momentum_4h" },
};

interface Options {
  essais?: unknown[];
  historique?: unknown[];
  filtreFerme?: boolean;
}

function stub(opts: Options = {}) {
  const messages: { chatId: number; text: string; keyboard?: unknown }[] = [];
  const patches: Record<string, unknown>[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("signal_deliveries")) return jsonResponse(opts.historique ?? []);
      if (url.includes("/users") && (!init || init.method === undefined)) {
        return jsonResponse(opts.essais ?? [essai()]);
      }
      if (url.includes("/users") && init?.method === "PATCH") {
        patches.push(JSON.parse(init.body as string));
        return jsonResponse([]);
      }
      if (url.includes("binance.com") || url.includes("kraken") || url.includes("coinbase")) {
        // Bougies BTC : nettement sous la moyenne si le filtre doit être fermé.
        const base = opts.filtreFerme ? 100 : 300;
        const rows = Array.from({ length: 250 }, (_, i) => [i * 86400000, "0", "0", "0", String(base + (opts.filtreFerme ? -i * 0.4 : i * 0.4)), "0"]);
        return jsonResponse(rows);
      }
      if (url.includes("api.telegram.org")) {
        const b = JSON.parse(init!.body as string);
        messages.push({ chatId: b.chat_id, text: b.text, keyboard: b.reply_markup });
        return jsonResponse({ ok: true, result: {} });
      }
      return jsonResponse([]);
    })
  );
  return { messages, patches };
}

describe("Point de mi-essai — avec des signaux reçus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("liste ce qui a été reçu, gagnants ET perdants", async () => {
    // Cacher les perdants ici, alors que la personne les a vus arriver,
    // détruirait la seule chose que ce produit vend.
    const { messages } = stub({ historique: [SIGNAL_GAGNANT, SIGNAL_PERDANT] });
    await sendTrialMidpointRecap(env);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain("BTC/USDT");
    expect(messages[0].text).toContain("ETH/USDT");
    expect(messages[0].text).toContain("✅");
    expect(messages[0].text).toContain("❌");
  });

  it("propose les deux paliers en boutons", async () => {
    const { messages } = stub({ historique: [SIGNAL_GAGNANT] });
    await sendTrialMidpointRecap(env);
    const clavier = JSON.stringify(messages[0].keyboard);
    expect(clavier).toContain("plan:1");
    expect(clavier).toContain("plan:2");
  });

  it("avertit que le suivi des positions ouvertes s'arrêtera", async () => {
    // C'est le vrai coût de ne pas s'abonner, et personne ne le disait.
    const { messages } = stub({ historique: [SIGNAL_OUVERT] });
    await sendTrialMidpointRecap(env);
    expect(messages[0].text).toMatch(/encore ouvertes/i);
    expect(messages[0].text).toMatch(/cesseras d'en recevoir le suivi/i);
  });

  it("ne prolonge RIEN quand des signaux ont été reçus", async () => {
    const { patches } = stub({ historique: [SIGNAL_GAGNANT] });
    await sendTrialMidpointRecap(env);
    // Un seul patch : le marquage. Aucune réactivation d'abonnement.
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ trial_recap_sent: true });
    expect(patches[0].expiration).toBeUndefined();
  });
});

describe("Point de mi-essai — aucun signal reçu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("le DIT franchement au lieu de l'ignorer", async () => {
    // La personne l'a remarqué. Un message enthousiaste qui l'ignore confirme
    // simplement qu'on ne la lit pas.
    const { messages } = stub({ historique: [], filtreFerme: true });
    await sendTrialMidpointRecap(env);
    expect(messages[0].text).toMatch(/tu n'as rien reçu/i);
    // Le chiffre vient de publishedStats, jamais d'une copie locale : c'est
    // ainsi que « 41 % » et « 42 % » ont pu coexister dans des textes voisins.
    expect(messages[0].text).toContain(PART_FILTRE_FERME);
  });

  it("prolonge l'essai automatiquement", async () => {
    // Trois jours dans un creux ne démontrent rien : facturer sur cette base
    // reviendrait à vendre un produit que la personne n'a pas pu juger.
    const { messages, patches } = stub({ historique: [], filtreFerme: true });
    await sendTrialMidpointRecap(env);
    expect(messages[0].text).toMatch(/prolongé de 3 jours/i);
    expect(patches.some((p) => p.expiration)).toBe(true);
  });

  it("VERROUILLE le récapitulatif après prolongation, sinon la boucle est infinie", async () => {
    // activateSubscription remet trial_recap_sent à false : sans re-verrouiller
    // ensuite, le message ET la prolongation repartiraient à chaque passage du
    // cron, toutes les quinze minutes.
    const { patches } = stub({ historique: [], filtreFerme: true });
    await sendTrialMidpointRecap(env);
    expect(patches[patches.length - 1]).toMatchObject({ trial_recap_sent: true });
  });

  it("n'affiche aucun bouton d'abonnement : ce n'est pas le moment de vendre", async () => {
    const { messages } = stub({ historique: [], filtreFerme: true });
    await sendTrialMidpointRecap(env);
    expect(messages[0].keyboard).toBeUndefined();
  });
});

describe("Point de mi-essai — quand il ne doit rien faire", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("attend que 24 h se soient écoulées", async () => {
    const { messages } = stub({ essais: [essai(70)], historique: [SIGNAL_GAGNANT] });
    await sendTrialMidpointRecap(env);
    expect(messages).toHaveLength(0);
  });

  it("ne touche à aucun abonné payant", async () => {
    // La requête filtre sur plan=0. On vérifie que le filtre part bien.
    let urlLue = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/users")) urlLue = url;
        return jsonResponse([]);
      })
    );
    await sendTrialMidpointRecap(env);
    expect(urlLue).toContain("plan=eq.0");
    expect(urlLue).toContain("trial_recap_sent=eq.false");
  });

  it("ne fait rien quand aucun essai n'est en cours", async () => {
    const { messages } = stub({ essais: [] });
    await sendTrialMidpointRecap(env);
    expect(messages).toHaveLength(0);
  });
});
