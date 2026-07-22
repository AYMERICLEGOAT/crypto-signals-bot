/**
 * Conversion USD -> crypto via l'API publique gratuite CoinGecko, avec un
 * petit cache pour éviter de spammer l'API si plusieurs utilisateurs
 * demandent une facture Monero/Litecoin au même moment. Le cache vit dans
 * l'isolat du Worker : un simple bonus de perf tant qu'il est chaud, jamais
 * une source de vérité (on ne peut pas compter sur sa persistance).
 */

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { price: number; fetchedAt: number }>();

export async function getUsdPrice(coinGeckoId: string): Promise<number> {
  const cached = cache.get(coinGeckoId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.price;
  }

  const res = await fetch(`${COINGECKO_URL}?ids=${coinGeckoId}&vs_currencies=usd`);
  if (!res.ok) throw new Error(`CoinGecko a répondu ${res.status}`);
  const data = (await res.json()) as Record<string, { usd?: number }>;
  const price = data[coinGeckoId]?.usd;
  if (!price) throw new Error(`Prix introuvable pour ${coinGeckoId} sur CoinGecko`);

  cache.set(coinGeckoId, { price, fetchedAt: Date.now() });
  return price;
}

export async function usdToCoinAmount(usdAmount: number, coinGeckoId: string): Promise<number> {
  const price = await getUsdPrice(coinGeckoId);
  return usdAmount / price;
}
