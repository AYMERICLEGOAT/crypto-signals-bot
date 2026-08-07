import { describe, it, expect, vi, afterEach } from "vitest";
import { trackCarryOutcomes } from "../src/cron/trackCarryOutcomes";
import {
  buildSignalMessage,
  buildCarryMessage,
  buildCarryShortMessage,
  buildCarryDetailKeyboard,
  buildCarryExplanation,
  SignalLike,
} from "../src/signalFormat";
import { getOpenSignals } from "../src/db/signals";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
} as any;

const db = { url: "https://fake-supabase.test", key: "k" } as any;

const carry: SignalLike = {
  type: "CARRY",
  pair: "SOL/USDT",
  entry_price: 142.5,
  stop_loss: null,
  take_profit: null,
  created_at: "2026-07-14T01:00:00.000Z",
  engine: "carry_funding",
  carry_expected_pct: 0.85,
  hold_until: "2026-08-04T01:00:00.000Z",
};

describe("message de carry", () => {
  it("explique les DEUX jambes, sans jamais afficher de stop ni d'objectif", () => {
    const texte = buildSignalMessage(carry);

    // Ce que l'abonné doit comprendre : ce n'est pas un pari sur le prix.
    expect(texte).toContain("Achat au comptant");
    expect(texte).toContain("Vente à découvert du perpétuel");
    expect(texte).toMatch(/neutre au marché/i);

    // Un carry n'a ni stop ni objectif : les afficher, même à zéro, ferait
    // croire à un niveau de prix à surveiller.
    expect(texte).not.toMatch(/Stop.?loss/i);
    expect(texte).not.toMatch(/Take profit/i);
    // Et surtout aucun NaN, ce que produirait un calcul de risque sur des nuls.
    expect(texte).not.toContain("NaN");
  });

  it("annonce le rendement ANNUALISÉ d'abord, le montant sur la période ensuite", () => {
    const texte = buildCarryMessage(carry, { avecExplication: true });
    // +0,85 % sur 21 jours = +15,7 % par an. Affiché brut, le premier chiffre
    // se lit comme dérisoire pour une position à deux jambes ; annualisé, il
    // devient comparable à n'importe quel produit de rendement. Les deux sont
    // vrais et les deux doivent figurer, dans cet ordre.
    expect(texte).toContain("par an");
    expect(texte).toContain("+0,8 %");   // 0,85 arrondi au dixieme
    expect(texte).toContain("21 jours");
    // Les trois honnêtetés obligatoires (voir buildCarryMessage).
    expect(texte).toContain("41 %");
    expect(texte).toMatch(/n'est pas sans risque|liquidée/i);
    expect(texte).toMatch(/21 jours/);
  });

  it("route un BUY vers le format classique, avec stop et objectif", () => {
    const achat: SignalLike = {
      type: "BUY", pair: "BTC/USDT", entry_price: 100, stop_loss: 90, take_profit: 130,
      created_at: "2026-08-01T00:00:00.000Z", engine: "relative_strength",
    };
    const texte = buildSignalMessage(achat);
    expect(texte).toContain("Take profit");
    expect(texte).toContain("Stop loss");
    expect(texte).not.toContain("NaN");
  });
});

describe("carry sur le canal public — forme courte", () => {
  // Le message du canal embarquait le bloc pédagogique de 1 200 caractères à
  // chaque lot : un carry occupait un écran entier de téléphone, et le premier
  // abonné l'a lu comme du spam. La forme courte ne garde que ce qui permet de
  // décider, et renvoie le reste dans /carry.
  const court = buildCarryShortMessage([carry]);

  it("tient en moins de 400 caractères, contre plus de 1 500 pour la forme longue", () => {
    expect(court.length).toBeLessThan(400);
    expect(buildCarryMessage(carry, { avecExplication: true }).length).toBeGreaterThan(1400);
  });

  it("met le rendement ANNUALISÉ en tête, en gras, avant le gain de période", () => {
    // +0,85 % sur 21 jours = +15,8 % par an. C'est la seule unité qui permette
    // de comparer un carry à quoi que ce soit d'autre.
    expect(court).toMatch(/\*\+15,8\s%\spar an\*/);
    expect(court.indexOf("par an")).toBeLessThan(court.indexOf("sur 21 j"));
  });

  it("affiche le gain de période à DEUX décimales", () => {
    // Au dixième, +0,85 % et +0,94 % s'afficheraient tous deux « +0,9 % »,
    // alors que leurs rendements annualisés diffèrent de deux points.
    expect(court).toMatch(/\+0,85\s%\ssur 21 j/);
  });

  it("chiffre la perte maximale au même niveau que le gain", () => {
    expect(court).toMatch(/-19,9\s%/);
    expect(court).toContain("risque de perte en capital");
  });

  it("annonce la clôture temporelle et n'invente ni stop ni objectif", () => {
    expect(court).toContain("Clôture dans 21 jours");
    expect(court).not.toContain("Stop-Loss");
    expect(court).not.toContain("Take profit");
  });

  it("ne répète PAS la paire quand il n'y a qu'un seul carry", () => {
    expect(court.match(/SOL\/USDT/g)).toHaveLength(1);
  });

  it("groupe plusieurs carrys en une ligne chacun, en nommant la paire", () => {
    const autre: SignalLike = { ...carry, pair: "ZEC/USDT", carry_expected_pct: 0.42 };
    const lot = buildCarryShortMessage([carry, autre]);
    expect(lot).toContain("*2 carrys ouverts*");
    expect(lot).toContain("*SOL/USDT*");
    expect(lot).toContain("*ZEC/USDT*");
    expect(lot.length).toBeLessThan(500);
  });

  it("laisse le bloc pédagogique HORS du message, joignable par le bouton", () => {
    expect(court).not.toContain("Comment marche un carry");
    expect(court).not.toContain("financement");
    const clavier = buildCarryDetailKeyboard("ProVIPSignals_bot");
    expect(clavier[0][0].url).toBe("https://t.me/ProVIPSignals_bot?start=carry");
    // Un bouton de canal doit être un lien : un callback_data ne peut pas
    // ouvrir une conversation avec un lecteur qui n'a jamais écrit au bot.
    expect(clavier[0][0].callback_data).toBeUndefined();
  });

  it("l'explication complète reste disponible et garde les trois précautions", () => {
    const long = buildCarryExplanation();
    expect(long).toContain("liquidée");
    expect(long).toContain("n'est pas acquis");
    expect(long).toContain("DEUX jambes");
  });

  it("ne plante pas si le rendement attendu est absent", () => {
    const sansRendement: SignalLike = { ...carry, carry_expected_pct: null };
    const texte = buildCarryShortMessage([sansRendement]);
    expect(texte).toContain("rendement non chiffré");
    expect(texte).not.toContain("NaN");
  });

  it("rend une chaîne vide sur une liste vide, plutôt qu'un message sans contenu", () => {
    expect(buildCarryShortMessage([])).toBe("");
  });
});

describe("getOpenSignals", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exclut les carrys du suivi par PRIX mais garde les signaux sans moteur", async () => {
    // Le filtrage se fait côté code et non en PostgREST : `not.eq` y écarterait
    // aussi les lignes dont `engine` est nul, c'est-à-dire tous les signaux
    // antérieurs à l'ajout de la colonne.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { id: 1, pair: "BTC/USDT", engine: "relative_strength" },
          { id: 2, pair: "SOL/USDT", engine: "carry_funding" },
          { id: 3, pair: "ETH/USDT", engine: null },
          { id: 4, pair: "ADA/USDT" },
        ])
      )
    );

    const rows = await getOpenSignals(db);
    expect(rows.map((r) => r.id)).toEqual([1, 3, 4]);
  });
});

describe("trackCarryOutcomes", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(fundingRows: unknown, opts: { expired?: unknown[] } = {}) {
    const patches: Record<string, unknown>[] = [];
    const messages: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("fundingRate")) return jsonResponse(fundingRows);
        if (url.includes("rest/v1/signals") && init?.method === "PATCH") {
          patches.push(JSON.parse(init.body as string));
          return jsonResponse([{}]);
        }
        if (url.includes("rest/v1/signals")) {
          return jsonResponse(
            opts.expired ?? [{
              id: 7, pair: "SOL/USDT", engine: "carry_funding",
              created_at: "2026-07-14T01:00:00.000Z", hold_until: "2026-08-04T01:00:00.000Z",
              carry_expected_pct: 0.85, outcome: null,
            }]
          );
        }
        if (url.includes("signal_deliveries")) return jsonResponse([{ telegram_id: 42 }]);
        if (url.includes("api.telegram.org")) {
          messages.push(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );
    return { patches, messages };
  }

  it("clôture sur le FINANCEMENT encaissé, jamais sur un prix", async () => {
    // 63 versements de 0,0167 % = 1,05 % de financement, moins 0,20 % de frais.
    const s = stub(Array.from({ length: 63 }, () => ({ fundingTime: 0, fundingRate: "0.000167" })));

    await trackCarryOutcomes(env);

    expect(s.patches).toHaveLength(1);
    const patch = s.patches[0];
    expect(patch.outcome).toBe("WIN");
    expect(patch.close_reason).toBe("carry_expired");
    expect(Number(patch.carry_realized_pct)).toBeCloseTo(0.8521, 2);
    // `outcome_price` doit rester absent : une position neutre au marché n'a
    // pas de prix de sortie qui décrive son résultat, et en écrire un ferait
    // apparaître un faux gain dans tous les récapitulatifs.
    expect(patch).not.toHaveProperty("outcome_price");
  });

  it("compte une perte quand le financement ne couvre pas les frais", async () => {
    const s = stub(Array.from({ length: 3 }, () => ({ fundingTime: 0, fundingRate: "0.00001" })));

    await trackCarryOutcomes(env);

    expect(s.patches[0].outcome).toBe("LOSS");
    expect(Number(s.patches[0].carry_realized_pct)).toBeLessThan(0);
    expect(s.messages[0]).toContain("Carry clôturé");
  });

  it("ferme AVANT le terme quand le financement s'est inversé", async () => {
    // Position ouverte hier, échéance dans 20 jours : elle n'est pas échue.
    // Mais le financement cumulé est descendu à -2 %, sous le stop de -1,5 % :
    // sans ce garde-fou elle courrait encore vingt jours à perdre.
    const hier = new Date(Date.now() - 86400000).toISOString();
    const dansVingtJours = new Date(Date.now() + 20 * 86400000).toISOString();
    const s = stub(
      [{ fundingTime: 0, fundingRate: "-0.02" }],
      { expired: [{ id: 9, pair: "PEPE/USDT", engine: "carry_funding", created_at: hier, hold_until: dansVingtJours, carry_expected_pct: 0.9, outcome: null }] }
    );

    await trackCarryOutcomes(env);

    expect(s.patches).toHaveLength(1);
    expect(s.patches[0].close_reason).toBe("carry_stop");
    expect(s.patches[0].outcome).toBe("LOSS");
    expect(s.messages[0]).toContain("Clôture anticipée");
    expect(s.messages[0]).toMatch(/financement s'est inversé/i);
  });

  it("laisse courir une position saine qui n'est pas encore échue", async () => {
    const hier = new Date(Date.now() - 86400000).toISOString();
    const dansVingtJours = new Date(Date.now() + 20 * 86400000).toISOString();
    const s = stub(
      [{ fundingTime: 0, fundingRate: "0.0003" }],
      { expired: [{ id: 10, pair: "SOL/USDT", engine: "carry_funding", created_at: hier, hold_until: dansVingtJours, carry_expected_pct: 0.9, outcome: null }] }
    );

    await trackCarryOutcomes(env);

    // Ni échue ni au stop : rien n'est écrit, rien n'est notifié.
    expect(s.patches).toHaveLength(0);
    expect(s.messages).toHaveLength(0);
  });

  it("ne clôture RIEN si le financement est indisponible", async () => {
    // Inscrire un résultat sans donnée reviendrait à inventer un chiffre que
    // l'abonné prendrait pour argent comptant.
    const patches: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("fundingRate")) return new Response("blocked", { status: 403 });
        if (url.includes("rest/v1/signals") && init?.method === "PATCH") {
          patches.push(JSON.parse(init.body as string));
          return jsonResponse([{}]);
        }
        if (url.includes("rest/v1/signals")) {
          return jsonResponse([{
            id: 7, pair: "SOL/USDT", engine: "carry_funding",
            created_at: "2026-07-14T01:00:00.000Z", hold_until: "2026-08-04T01:00:00.000Z",
            carry_expected_pct: 0.85, outcome: null,
          }]);
        }
        return jsonResponse([]);
      })
    );

    await expect(trackCarryOutcomes(env)).resolves.toBeUndefined();
    expect(patches).toHaveLength(0);
  });

  it("ne plante pas tant que la migration section 46 n'est pas appliquée", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("rest/v1/signals")) {
          return new Response(JSON.stringify({ message: 'column "hold_until" does not exist' }), { status: 400 });
        }
        return jsonResponse([]);
      })
    );

    await expect(trackCarryOutcomes(env)).resolves.toBeUndefined();
  });
});
