/**
 * Client de prix courants pour le suivi post-trade (cron/trackSignalOutcomes.ts)
 * — la génération des signaux elle-même reste dans signals/main.py (source
 * hybride Python, indépendante).
 *
 * Bug trouvé le 03/08 (routine) : Binance bloque géographiquement les
 * requêtes depuis les IP Cloudflare Workers (HTTP 451), exactement comme il
 * bloque déjà les runners GitHub Actions (voir signals/README.md et
 * .github/workflows/signals.yml). Résultat : `getCurrentPrices` échouait à
 * CHAQUE cycle de 5 min depuis le déploiement de ce cron, silencieusement
 * (le seul signe était `console.error`, jamais remonté à l'admin) — aucun
 * signal n'a donc jamais pu être clôturé sur TP/SL réel, seulement par le
 * timeout de 10 jours. Corrigé par un repli Coinbase Exchange puis Kraken,
 * mêmes sources et même ordre de priorité que signals/main.py::fetch_recent_prices
 * (CoinGecko omis ici : nécessite un mapping id-par-actif que cette source de
 * secours ponctuelle ne justifie pas, Coinbase seul couvre déjà 100% de
 * l'univers des paires actuellement tradées).
 */

const BINANCE_BASE_URL = "https://api.binance.com";
const COINBASE_BASE_URL = "https://api.exchange.coinbase.com";
const KRAKEN_BASE_URL = "https://api.kraken.com";

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

const KRAKEN_BASE_ALIASES: Record<string, string> = { BTC: "XBT", DOGE: "XDG" };

export function pairToSymbol(pair: string): string {
  return pair.replace("/", "");
}

function baseAsset(pair: string): string {
  return pair.split("/")[0];
}

async function getBinancePrices(symbols: string[]): Promise<Record<string, number>> {
  const url = `${BINANCE_BASE_URL}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance ticker/price a répondu ${res.status}`);
      const data = (await res.json()) as { symbol: string; price: string }[];
      const prices: Record<string, number> = {};
      for (const row of data) prices[row.symbol] = Number(row.price);
      return prices;
    } catch (err) {
      lastError = err;
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function getCoinbasePrice(pair: string): Promise<number | null> {
  const productId = `${baseAsset(pair)}-USD`;
  try {
    const res = await fetch(`${COINBASE_BASE_URL}/products/${productId}/ticker`);
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: string };
    const price = data.price !== undefined ? Number(data.price) : NaN;
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

async function getKrakenPrice(pair: string): Promise<number | null> {
  const base = baseAsset(pair);
  const krakenPair = `${KRAKEN_BASE_ALIASES[base] ?? base}USDT`;
  try {
    const res = await fetch(`${KRAKEN_BASE_URL}/0/public/Ticker?pair=${krakenPair}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { error?: string[]; result?: Record<string, { c?: string[] }> };
    if (data.error && data.error.length > 0) return null;
    const entry = data.result ? Object.values(data.result)[0] : undefined;
    const price = entry?.c?.[0] !== undefined ? Number(entry.c[0]) : NaN;
    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

/**
 * Retourne {symbole (sans "/"): prix} pour les paires demandées (format
 * "BASE/QUOTE", ex. "LTC/USDT"). Binance d'abord (un seul appel groupé) ;
 * toute paire manquante après ça (échec total ou juste absente de la
 * réponse) est retentée individuellement via Coinbase puis Kraken.
 */
export async function getCurrentPrices(pairs: string[]): Promise<Record<string, number>> {
  if (pairs.length === 0) return {};
  const symbols = pairs.map(pairToSymbol);

  let prices: Record<string, number> = {};
  try {
    prices = await getBinancePrices(symbols);
  } catch (err) {
    console.error("[post-trade] Échec de récupération des prix Binance, bascule sur Coinbase/Kraken:", err);
  }

  const missing = pairs.filter((pair) => prices[pairToSymbol(pair)] === undefined);
  for (const pair of missing) {
    const symbol = pairToSymbol(pair);
    const coinbasePrice = await getCoinbasePrice(pair);
    if (coinbasePrice !== null) {
      prices[symbol] = coinbasePrice;
      continue;
    }
    const krakenPrice = await getKrakenPrice(pair);
    if (krakenPrice !== null) {
      prices[symbol] = krakenPrice;
    } else {
      console.error(`[post-trade] Aucune source de prix disponible pour ${pair} (Binance/Coinbase/Kraken tous en échec).`);
    }
  }

  return prices;
}
