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

const ENDPOINTS = [
  "https://fapi.binance.com/fapi/v1/fundingRate",
  "https://www.binance.com/fapi/v1/fundingRate",
];
const HEADERS = { "User-Agent": "crypto-signals-bot" };
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 400;

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
  for (const base of ENDPOINTS) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const url = `${base}?symbol=${symbol}&startTime=${startMs}&endTime=${endMs}&limit=1000`;
        const res = await fetch(url, { headers: HEADERS });
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
  return null;
}
