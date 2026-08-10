import { describe, it, expect, vi, afterEach } from "vitest";
import { getCurrentPrices } from "../src/market/binancePrices";
import { reinitialiserJournalUneFois } from "../src/utils/logUneFois";

/**
 * LE REPLI INTERMÉDIAIRE ÉTAIT MORT, SUR UNE HYPOTHÈSE FAUSSE ÉCRITE EN
 * COMMENTAIRE.
 *
 * Le code affirmait : « Kraken renvoie une erreur par paire inconnue tout en
 * servant les autres : on ne jette donc pas, on prend ce qui est exploitable ».
 * Mesuré contre l'API le 10/08/2026 :
 *
 *   ?pair=SOLUSDT,BNBUSDT,TAOUSDT,POLUSDT,ICPUSDT,ADAUSDT
 *   -> {"error":["EQuery:Unknown asset pair"],"result":{}}
 *
 * C'est du tout ou rien. TAO et POL ne sont pas listées chez Kraken alors
 * qu'elles font partie de l'univers analysé : l'appel groupé rendait donc {}
 * en permanence, et l'intégralité du suivi post-trade retombait sur Coinbase,
 * paire par paire, qui limite les IP de sortie Cloudflare. Les journaux de
 * production le montraient sans ambiguïté :
 *
 *   (error) [post-trade] Coinbase BNB-USD a répondu 429 (tentative 1/2)
 *   (error) [post-trade] Coinbase TAO-USD a répondu 429 (tentative 1/2)
 *   (error) [post-trade] Coinbase POL-USD a répondu 429 (tentative 1/2)
 *
 * L'enjeu n'est pas cosmétique : un signal dont le prix n'est jamais récupéré
 * ne se clôture jamais. Il reste ouvert au-delà de son échéance, et l'abonné
 * ne reçoit ni sortie, ni résultat.
 *
 * BNB est pourtant parfaitement cotée par Kraken en requête unitaire. C'est
 * tout l'objet du rattrapage : ne laisser à Coinbase que ce que Kraken ignore
 * VRAIMENT.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Paires réellement absentes de Kraken, vérifiées le 10/08/2026. */
const INCONNUES_KRAKEN = new Set(["TAO", "POL"]);

function stub() {
  const appels: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      appels.push(url);

      if (url.includes("binance")) return new Response("blocked", { status: 403 });

      if (url.includes("kraken")) {
        const demandees = decodeURIComponent(url.split("pair=")[1] ?? "").split(",");
        const bases = demandees.map((p) => p.replace(/USDT$/, ""));
        // Le comportement RÉEL : une seule inconnue annule toute la réponse.
        if (bases.some((b) => INCONNUES_KRAKEN.has(b))) {
          return jsonResponse({ error: ["EQuery:Unknown asset pair"], result: {} });
        }
        const result: Record<string, { c: string[] }> = {};
        for (const b of bases) result[`${b}USDT`] = { c: ["100.5"] };
        return jsonResponse({ error: [], result });
      }

      // Coinbase limite les IP Cloudflare : c'est ce qu'on cherche à éviter.
      return new Response("rate limited", { status: 429 });
    })
  );

  const compte = (h: string) => appels.filter((u) => u.includes(h)).length;
  return { appels, compte };
}

describe("L'appel Kraken groupé est du tout ou rien", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    reinitialiserJournalUneFois();
  });

  it("récupère quand même le prix des paires que Kraken cote", async () => {
    // La propriété qui compte. SOL et BNB sont cotées ; elles ne doivent pas
    // être perdues parce que TAO et POL partageaient leur requête.
    stub();
    const prix = await getCurrentPrices(["SOL/USDT", "BNB/USDT", "TAO/USDT", "POL/USDT"]);
    expect(prix["SOLUSDT"], "SOL perdu a cause d'une AUTRE paire du lot").toBeCloseTo(100.5);
    expect(prix["BNBUSDT"], "BNB perdu a cause d'une AUTRE paire du lot").toBeCloseTo(100.5);
  });

  it("ne laisse à Coinbase que ce que Kraken ignore vraiment", async () => {
    // Trois requêtes limitées deviennent zéro pour SOL et BNB. Coinbase ne
    // voit plus que TAO et POL.
    const s = stub();
    await getCurrentPrices(["SOL/USDT", "BNB/USDT", "TAO/USDT", "POL/USDT"]);
    const coinbase = s.appels.filter((u) => u.includes("coinbase"));
    expect(coinbase.some((u) => u.includes("SOL-USD"))).toBe(false);
    expect(coinbase.some((u) => u.includes("BNB-USD"))).toBe(false);
    expect(coinbase.some((u) => u.includes("TAO-USD"))).toBe(true);
  });

  it("n'ajoute AUCUNE requête quand le groupé a suffi", async () => {
    // Le rattrapage unitaire ne doit pas devenir le régime normal : le budget
    // de cinquante sous-requêtes par invocation est le point de rupture connu
    // de ce projet.
    const s = stub();
    await getCurrentPrices(["SOL/USDT", "BNB/USDT"]);
    expect(s.compte("kraken"), "requetes unitaires inutiles apres un groupe reussi").toBe(1);
  });

  it("ne réessaie pas paire par paire quand le groupé a servi une partie du lot", async () => {
    // Distinction volontaire : le rattrapage ne se déclenche que sur un échec
    // TOTAL. Un groupé partiellement servi n'est pas le défaut visé, et
    // relancer N requêtes dessus gaspillerait le budget.
    const s = stub();
    await getCurrentPrices(["SOL/USDT", "BNB/USDT", "ADA/USDT"]);
    expect(s.compte("kraken")).toBe(1);
  });
});
