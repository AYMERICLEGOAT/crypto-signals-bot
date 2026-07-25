/**
 * Client minimal pour l'API publique Binance (aucune clé requise), utilisé
 * UNIQUEMENT pour le suivi post-trade (cron/trackSignalOutcomes.ts) — la
 * génération des signaux elle-même reste dans signals/binance_client.py.
 * Même endpoint/format que ce client Python (params.symbols en JSON compact).
 */

const BASE_URL = "https://api.binance.com";

export function pairToSymbol(pair: string): string {
  return pair.replace("/", "");
}

/** Retourne {symbole: prix}. Un seul appel HTTP pour toutes les paires demandées. */
export async function getCurrentPrices(symbols: string[]): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  const url = `${BASE_URL}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ticker/price a répondu ${res.status}`);
  const data = (await res.json()) as { symbol: string; price: string }[];

  const prices: Record<string, number> = {};
  for (const row of data) prices[row.symbol] = Number(row.price);
  return prices;
}
