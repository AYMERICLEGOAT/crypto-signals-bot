/**
 * Taux de financement des perpétuels Binance, pour le suivi des carrys.
 *
 * Pourquoi un client dédié plutôt qu'un ajout à binancePrices.ts : celui-ci
 * sert des PRIX courants, utiles à un suivi directionnel. Un carry est neutre
 * au marché — son résultat ne dépend pas du prix mais du financement encaissé
 * entre l'ouverture et la clôture. Ce sont deux données et deux endpoints sans
 * rapport, et les mélanger rendrait le suivi post-trade confus.
 *
 * Contrainte connue et déjà payée sur ce projet : Binance bloque les IP de
 * sortie Cloudflare (403 observé en production le 03/08 sur l'API spot). Le
 * miroir www.binance.com est donc essayé ensuite. Si les deux échouent, la
 * fonction rend `null` — jamais 0, qui se lirait comme « financement nul » et
 * inscrirait un résultat faux en base.
 */

import { journaliserPanneConnue } from "../utils/logUneFois";

const ENDPOINTS = [
  "https://fapi.binance.com/fapi/v1/fundingRate",
  "https://www.binance.com/fapi/v1/fundingRate",
];
const BYBIT_ENDPOINT = "https://api.bybit.com/v5/market/funding/history";
const HEADERS = { "User-Agent": "crypto-signals-bot" };
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

/**
 * Un refus définitif ne se réessaie pas, et ne change pas de miroir.
 *
 * Binance bloque les plages d'IP d'hébergeur : les deux endpoints ci-dessus
 * sont le MÊME service derrière le même blocage. Les journaux de production du
 * 14/08/2026 le montraient quatre fois par paire, à chaque cycle :
 *
 *   [carry] https://fapi.binance.com/... a répondu 403 pour ZROUSDT (1/2)
 *   [carry] https://fapi.binance.com/... a répondu 403 pour ZROUSDT (2/2)
 *   [carry] https://www.binance.com/... a répondu 403 pour ZROUSDT (1/2)
 *   [carry] https://www.binance.com/... a répondu 403 pour ZROUSDT (2/2)
 *   [carry] ZRO/USDT : financement indisponible, clôture reportée.
 *
 * Avec dix carrys ouverts, cela faisait QUARANTE sous-requêtes gaspillées par
 * passage — dans une chaîne plafonnée à cinquante par invocation. Ce n'est
 * donc pas seulement du bruit : c'est le budget qui a déjà tué huit tâches
 * pendant cinq jours, consommé intégralement par des requêtes dont on connaît
 * la réponse à l'avance.
 */
function refusDefinitif(status: number): boolean {
  return status === 401 || status === 403 || status === 451;
}

interface BybitRow {
  fundingRate: string;
  fundingRateTimestamp: string;
}

/**
 * Financement encaissé selon Bybit, quand Binance refuse.
 *
 * LE CARRY ÉTAIT ENTIÈREMENT MORT SANS CETTE SOURCE. Binance bloque les IP
 * Cloudflare sur son API futures exactement comme sur le spot, et le seul
 * repli prévu était un miroir du même service. Les dix positions de carry
 * ouvertes ne pouvaient donc PAS se clôturer — indéfiniment, en journalisant
 * poliment « clôture reportée au prochain cycle » à chaque passage.
 *
 * Or le carry est la jambe que le produit présente comme la plus fiable
 * (84,2 % de gagnants). Elle était en panne totale et silencieuse.
 *
 * Bybit vérifié le 14/08/2026 sur la requête exacte de production : 42 lignes
 * de financement rendues sur sept jours pour ZROUSDT, somme +0,2100 %. Son
 * taux instantané concorde avec celui d'OKX et de Gate au centième près.
 */
async function getFundingBybit(symbol: string, startMs: number, endMs: number): Promise<number | null> {
  try {
    const url = `${BYBIT_ENDPOINT}?category=linear&symbol=${symbol}&startTime=${startMs}&endTime=${endMs}&limit=200`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) {
      console.error(`[carry] Bybit a répondu ${res.status} pour ${symbol}.`);
      return null;
    }
    const data = (await res.json()) as { retCode?: number; result?: { list?: BybitRow[] } };
    const lignes = data.result?.list;
    if (!Array.isArray(lignes) || lignes.length === 0) return null;
    return lignes.reduce((total, row) => total + Number(row.fundingRate) * 100, 0);
  } catch (err) {
    console.error(`[carry] Bybit injoignable pour ${symbol} :`, err);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function pairToPerpSymbol(pair: string): string {
  return pair.replace("/", "");
}

interface FundingRow {
  fundingTime: number;
  fundingRate: string;
}

/**
 * Somme du financement versé sur `pair` entre deux instants, en POURCENTAGE.
 *
 * C'est exactement ce qu'a encaissé le vendeur du perpétuel, donc le résultat
 * brut du carry avant frais. Retourne null si aucune source ne répond.
 */
export async function getFundingCollectedPct(
  pair: string,
  startMs: number,
  endMs: number
): Promise<number | null> {
  const symbol = pairToPerpSymbol(pair);
  let binanceRefuse = false;

  for (const base of ENDPOINTS) {
    if (binanceRefuse) break; // les deux endpoints sont le même service, derrière le même blocage
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const url = `${base}?symbol=${symbol}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
        const res = await fetch(url, { headers: HEADERS });
        if (refusDefinitif(res.status)) {
          // Une ligne par heure au lieu de quatre par paire et par cycle.
          journaliserPanneConnue("carry-binance", `API futures Binance : ${res.status} (blocage d'IP d'hébergeur) — repli sur Bybit.`);
          binanceRefuse = true;
          break;
        }
        if (!res.ok) {
          console.error(`[carry] ${base} a répondu ${res.status} pour ${symbol} (tentative ${attempt}/${MAX_ATTEMPTS})`);
          await sleep(RETRY_DELAY_MS * attempt);
          continue;
        }
        const rows = (await res.json()) as FundingRow[];
        if (!Array.isArray(rows) || rows.length === 0) {
          // Réponse valide mais vide : la paire n'a pas de perpétuel sur cette
          // fenêtre. Ce n'est pas une panne, inutile d'essayer le miroir.
          return null;
        }
        return rows.reduce((total, row) => total + Number(row.fundingRate) * 100, 0);
      } catch (err) {
        console.error(`[carry] Erreur ${base} pour ${symbol} (tentative ${attempt}/${MAX_ATTEMPTS}):`, err);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }

  // Repli réel, pas un miroir du même service bloqué.
  return getFundingBybit(symbol, startMs, endMs);
}
