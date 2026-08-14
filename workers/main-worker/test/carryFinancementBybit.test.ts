import { describe, it, expect, vi, afterEach } from "vitest";
import { getFundingCollectedPct } from "../src/market/funding";
import { reinitialiserJournalUneFois } from "../src/utils/logUneFois";

/**
 * LE MOTEUR CARRY ÉTAIT ENTIÈREMENT MORT, EN SILENCE.
 *
 * Journaux de production du 14/08/2026, cron des quinze minutes :
 *
 *   [carry] 10 carry(s) ouvert(s) à examiner.
 *   [carry] https://fapi.binance.com/... a répondu 403 pour ZROUSDT (1/2)
 *   [carry] https://fapi.binance.com/... a répondu 403 pour ZROUSDT (2/2)
 *   [carry] https://www.binance.com/... a répondu 403 pour ZROUSDT (1/2)
 *   [carry] https://www.binance.com/... a répondu 403 pour ZROUSDT (2/2)
 *   [carry] ZRO/USDT : financement indisponible, clôture reportée au cycle suivant.
 *
 * Binance bloque les plages d'IP d'hébergeur sur son API futures exactement
 * comme sur le spot — et le seul repli prévu était un MIROIR DU MÊME SERVICE,
 * derrière le même blocage. Aucune des dix positions de carry ne pouvait donc
 * se clôturer, indéfiniment, pendant que le journal répétait poliment que la
 * clôture était « reportée ».
 *
 * Le carry est la jambe que le produit présente comme la plus fiable : 84,2 %
 * de gagnants, mise en avant dans /subscribe, /demo et /help. Elle était en
 * panne totale.
 *
 * DEUXIÈME DÉGÂT, moins visible et peut-être pire : quatre requêtes par paire
 * et par passage, dix carrys ouverts — QUARANTE sous-requêtes gaspillées dans
 * une chaîne plafonnée à cinquante par invocation. C'est le budget qui a déjà
 * tué huit tâches pendant cinq jours, consommé intégralement par des requêtes
 * dont la réponse était connue d'avance.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

interface Options {
  /** Bybit répond-il ? */
  bybitOk?: boolean;
}

function stub(opts: Options = {}) {
  const appels: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      appels.push(url);
      if (url.includes("binance")) return new Response("blocked", { status: 403 });
      if (url.includes("bybit")) {
        if (opts.bybitOk === false) return new Response("down", { status: 503 });
        return jsonResponse({
          retCode: 0,
          result: {
            list: [
              { symbol: "ZROUSDT", fundingRate: "0.00005", fundingRateTimestamp: "1786708800000" },
              { symbol: "ZROUSDT", fundingRate: "0.00010", fundingRateTimestamp: "1786680000000" },
            ],
          },
        });
      }
      return jsonResponse([]);
    })
  );
  const compte = (h: string) => appels.filter((u) => u.includes(h)).length;
  return { appels, compte };
}

const DEBUT = 1786118400000;
const FIN = 1786719000000;

describe("Le carry se clôture malgré le blocage de Binance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    reinitialiserJournalUneFois();
  });

  it("récupère le financement chez Bybit", async () => {
    // La propriété qui compte : sans elle, la position ne se ferme jamais.
    stub();
    const pct = await getFundingCollectedPct("ZRO/USDT", DEBUT, FIN);
    expect(pct).toBeCloseTo(0.015, 4); // (0,00005 + 0,0001) x 100
  });

  it("n'interroge Binance QU'UNE FOIS sur un 403", async () => {
    // Quatre requêtes par paire devenaient quarante avec dix carrys ouverts,
    // dans une chaîne plafonnée à cinquante par invocation.
    const s = stub();
    await getFundingCollectedPct("ZRO/USDT", DEBUT, FIN);
    expect(s.compte("binance"), "Binance réessayé alors que 403 est définitif").toBe(1);
  });

  it("ne tente pas le miroir www.binance.com, qui est le même blocage", async () => {
    const s = stub();
    await getFundingCollectedPct("ZRO/USDT", DEBUT, FIN);
    expect(s.appels.some((u) => u.includes("www.binance.com"))).toBe(false);
  });

  it("rend null — jamais 0 — quand aucune source ne répond", async () => {
    // Zéro se lirait comme « financement nul » et inscrirait un résultat FAUX
    // en base, c'est-à-dire un carry clôturé à un rendement inventé.
    stub({ bybitOk: false });
    expect(await getFundingCollectedPct("ZRO/USDT", DEBUT, FIN)).toBeNull();
  });
});
