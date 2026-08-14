/**
 * Client de prix courants pour le suivi post-trade (cron/trackSignalOutcomes.ts)
 * — la génération des signaux elle-même reste dans signals/main.py (source
 * hybride Python, indépendante).
 *
 * Bug trouvé le 03/08 (routine) : Binance bloque les requêtes venant des IP
 * Cloudflare Workers, exactement comme il bloque déjà les runners GitHub
 * Actions (voir signals/README.md et .github/workflows/signals.yml). Résultat :
 * `getCurrentPrices` échouait à CHAQUE cycle de 5 min depuis le déploiement de
 * ce cron, silencieusement — le seul signe était un `console.error` jamais
 * remonté à l'admin. Aucun signal n'a donc jamais pu être clôturé sur un TP ou
 * un SL réellement atteint, uniquement par le timeout de 10 jours ; tous les
 * résultats de suivi post-trade accumulés jusqu'ici sont à considérer comme
 * non représentatifs.
 *
 * Vérifié en production le même jour via `wrangler tail` : Binance répond 403
 * (et non 451 comme supposé au départ) et le repli s'active bien. Ce même
 * relevé a révélé un second défaut, corrigé dans la foulée : Coinbase Exchange
 * renvoyait 429 sur toutes ses tentatives, parce que le repli l'interrogeait
 * paire par paire et que le retry réessayait sans le moindre délai. D'où
 * l'ordre actuel — Kraken groupé avant Coinbase — et des attentes progressives.
 *
 * CoinGecko est volontairement absent : il demande un mapping id-par-actif que
 * cette source de secours ne justifie pas.
 */

import { journaliserPanneConnue } from "../utils/logUneFois";

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

/**
 * UN REFUS DÉFINITIF NE SE RÉESSAIE PAS.
 *
 * Binance répond 403 aux IP de sortie Cloudflare — un blocage de plage
 * d'hébergeur, pas un incident. Observé en production le 10/08/2026 : à chaque
 * cycle de cinq minutes, ce client tentait TROIS fois, avec 400 puis 800 ms
 * d'attente, avant de passer à Kraken. Soit trois sous-requêtes et 1,2 seconde
 * jetées, 288 fois par jour, dans une chaîne dont la limite de cinquante
 * sous-requêtes par invocation est déjà le point de rupture connu du projet.
 *
 * Aucun de ces statuts ne change en réessayant la même requête depuis la même
 * IP dans la seconde. Le repli — Kraken groupé — est la vraie réponse, et il
 * doit partir tout de suite.
 */
function refusDefinitif(status: number): boolean {
  return status === 401 || status === 403 || status === 404 || status === 451;
}

async function getBinancePrices(symbols: string[]): Promise<Record<string, number>> {
  const url = `${BINANCE_BASE_URL}/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url);
      if (refusDefinitif(res.status)) {
        // Une ligne par HEURE, pas une par cycle. La déduplication en mémoire
        // ne tient pas : chaque déclenchement de cron repart d'un isolat neuf,
        // ce que la production a montré en journalisant ce 403 à 19:55 puis à
        // 20:00 (voir utils/logUneFois::journaliserPanneConnue).
        journaliserPanneConnue("prix-binance", `Binance ticker/price a répondu ${res.status} — repli immédiat sur Kraken.`);
        throw new Error(`Binance ticker/price a répondu ${res.status} — repli immédiat sur Kraken.`);
      }
      if (!res.ok) throw new Error(`Binance ticker/price a répondu ${res.status}`);
      const data = (await res.json()) as { symbol: string; price: string }[];
      const prices: Record<string, number> = {};
      for (const row of data) prices[row.symbol] = Number(row.price);
      return prices;
    } catch (err) {
      lastError = err;
      // Le refus définitif ressort immédiatement : le réessayer serait
      // exactement le gaspillage que cette fonction vient d'éliminer.
      if (err instanceof Error && /a répondu (401|403|404|451)/.test(err.message)) throw err;
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

// Coinbase Exchange bloque parfois les requêtes sans User-Agent explicite
// (déjà observé côté Python, voir signals/coinbase_client.py) ; un léger
// retry absorbe les 429/blips transitoires sans épuiser le budget de
// sous-requêtes du Worker (au plus 2 tentatives par source, par paire).
const FALLBACK_HEADERS = { "User-Agent": "crypto-signals-bot" };
// Deux tentatives, pas trois. Le budget total compte ici : trois sources en
// cascade, chacune retentée, avec N paires à traiter chez Coinbase, se
// cumulent vite — et ce cron doit tenir dans un cycle de 5 minutes en laissant
// de la marge aux écritures Supabase qui suivent. Deux tentatives espacées
// valent mieux que trois collées : c'est l'attente qui absorbe un 429, pas le
// nombre d'essais.
const FALLBACK_MAX_ATTEMPTS = 2;
// Coinbase Exchange limite l'API publique par IP, et les IP de sortie
// Cloudflare sont partagées : le budget est donc déjà largement entamé par
// d'autres. Réessayer immédiatement — ce que faisait la première version avec
// un `continue` sans délai — garantit un second 429. L'attente est
// progressive, et un court espacement sépare aussi deux paires consécutives.
const FALLBACK_RETRY_DELAY_MS = 350;
const COINBASE_SPACING_MS = 150;
/**
 * Plafond du rattrapage Kraken paire par paire. Il ne s'agit pas d'économiser
 * Kraken — son API publique tolère largement ce volume — mais le budget de
 * cinquante sous-requêtes par invocation du Worker, qui est le point de
 * rupture connu de ce projet : c'est lui qui a tué huit tâches pendant cinq
 * jours. Au-delà de douze positions ouvertes, le résidu passe par Coinbase.
 */
const MAX_KRAKEN_UNITAIRE = 12;
const KRAKEN_SPACING_MS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCoinbasePrice(pair: string): Promise<number | null> {
  const productId = `${baseAsset(pair)}-USD`;
  for (let attempt = 1; attempt <= FALLBACK_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${COINBASE_BASE_URL}/products/${productId}/ticker`, { headers: FALLBACK_HEADERS });
      if (!res.ok) {
        console.error(`[post-trade] Coinbase ${productId} a répondu ${res.status} (tentative ${attempt}/${FALLBACK_MAX_ATTEMPTS})`);
        await sleep(FALLBACK_RETRY_DELAY_MS * attempt);
        continue;
      }
      const data = (await res.json()) as { price?: string };
      const price = data.price !== undefined ? Number(data.price) : NaN;
      return Number.isFinite(price) ? price : null;
    } catch (err) {
      console.error(`[post-trade] Erreur Coinbase ${productId} (tentative ${attempt}/${FALLBACK_MAX_ATTEMPTS}):`, err);
      await sleep(FALLBACK_RETRY_DELAY_MS * attempt);
    }
  }
  return null;
}

/**
 * Prix Kraken pour TOUTES les paires demandées en un seul appel.
 *
 * Kraken accepte une liste séparée par des virgules sur /0/public/Ticker, ce
 * qui remplace N requêtes par une seule. C'est ce qui manquait au premier
 * correctif : le repli interrogeait Coinbase paire par paire et se faisait
 * limiter (429 observé en production le 03/08 sur XLM), alors qu'un appel
 * groupé ne déclenche aucune limitation.
 *
 * Les clés de la réponse ne sont pas celles de la requête — Kraken renvoie ses
 * noms canoniques (XBTUSDT, XXBTZUSD selon l'ancienneté de la paire). Le
 * rapprochement se fait donc par préfixe d'actif de base, avec les alias
 * historiques (BTC -> XBT, DOGE -> XDG) et le X/Z que Kraken ajoute aux
 * actifs listés avant 2018.
 */
async function getKrakenPrices(pairs: string[], cotation: "USDT" | "USD" = "USDT"): Promise<Record<string, number>> {
  if (pairs.length === 0) return {};
  const wanted = pairs.map((pair) => {
    const base = baseAsset(pair);
    return { pair, base, alias: KRAKEN_BASE_ALIASES[base] ?? base };
  });
  const query = wanted.map((w) => `${w.alias}${cotation}`).join(",");

  for (let attempt = 1; attempt <= FALLBACK_MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${KRAKEN_BASE_URL}/0/public/Ticker?pair=${query}`, { headers: FALLBACK_HEADERS });
      if (!res.ok) {
        console.error(`[post-trade] Kraken (groupé, ${wanted.length} paires) a répondu ${res.status} (tentative ${attempt}/${FALLBACK_MAX_ATTEMPTS})`);
        await sleep(FALLBACK_RETRY_DELAY_MS * attempt);
        continue;
      }
      const data = (await res.json()) as { error?: string[]; result?: Record<string, { c?: string[] }> };
      // CE COMMENTAIRE DISAIT L'INVERSE DE LA RÉALITÉ, ET ÇA A COÛTÉ LE REPLI
      // ENTIER. Il affirmait : « Kraken renvoie une erreur par paire inconnue
      // tout en servant les autres ». Mesuré contre l'API le 10/08/2026 :
      //
      //   ?pair=SOLUSDT,BNBUSDT,TAOUSDT,POLUSDT,ICPUSDT,ADAUSDT
      //   -> {"error":["EQuery:Unknown asset pair"],"result":{}}
      //
      // C'est du tout ou rien. UNE seule paire non listée — TAO et POL le
      // sont, alors qu'elles sont dans l'univers analysé — annule la réponse
      // pour les six. Le repli intermédiaire rendait donc {} en permanence, et
      // TOUT le suivi post-trade retombait sur Coinbase, paire par paire, qui
      // limite les IP Cloudflare : « Coinbase BNB-USD a répondu 429 »,
      // « TAO-USD 429 », « POL-USD 429 » dans les journaux de production.
      //
      // Un signal dont le prix n'est jamais récupéré ne se clôture jamais : il
      // reste ouvert au-delà de son échéance, et l'abonné ne reçoit ni sortie
      // ni résultat.
      const result = data.result ?? {};
      const out: Record<string, number> = {};
      for (const { pair, alias } of wanted) {
        const key = Object.keys(result).find(
          (k) => k.startsWith(`${alias}USD`) || k.startsWith(`X${alias}ZUSD`) || k.startsWith(`X${alias}USD`),
        );
        const raw = key ? result[key]?.c?.[0] : undefined;
        const price = raw !== undefined ? Number(raw) : NaN;
        if (Number.isFinite(price) && price > 0) out[pairToSymbol(pair)] = price;
      }
      return out;
    } catch (err) {
      console.error(`[post-trade] Erreur Kraken groupé (tentative ${attempt}/${FALLBACK_MAX_ATTEMPTS}):`, err);
      await sleep(FALLBACK_RETRY_DELAY_MS * attempt);
    }
  }
  return {};
}

/**
 * Retourne {symbole (sans "/"): prix} pour les paires demandées (format
 * "BASE/QUOTE", ex. "LTC/USDT").
 *
 * Ordre : Binance groupé, puis Kraken groupé, puis Coinbase paire par paire.
 *
 * Cet ordre est volontairement différent de celui des fetchers Python
 * (signals/main.py), pour une raison propre à ce contexte : Kraken sert toutes
 * les paires manquantes en UN appel, là où Coinbase Exchange exige une requête
 * par paire et limite les IP de sortie Cloudflare, qui sont partagées. Le
 * premier correctif plaçait Coinbase devant et a produit en production, le
 * 03/08, un 429 sur chaque tentative pour XLM — donc aucun prix du tout. Un
 * appel groupé qui couvre l'essentiel laisse à Coinbase un volume résiduel
 * qu'il tolère.
 */
export async function getCurrentPrices(pairs: string[]): Promise<Record<string, number>> {
  if (pairs.length === 0) return {};
  const symbols = pairs.map(pairToSymbol);

  let prices: Record<string, number> = {};
  try {
    prices = await getBinancePrices(symbols);
  } catch (err) {
    // Un refus définitif est DÉJÀ journalisé une fois par panne dans
    // getBinancePrices. Le redire ici rendrait la déduplication inutile — la
    // ligne repartirait à chaque cycle de cinq minutes, ce qu'elle faisait.
    const definitif = err instanceof Error && /a répondu (401|403|404|451)/.test(err.message);
    if (!definitif) {
      console.error("[post-trade] Échec de récupération des prix Binance, bascule sur Kraken/Coinbase:", err);
    }
  }

  let missing = pairs.filter((pair) => prices[pairToSymbol(pair)] === undefined);
  if (missing.length > 0) {
    Object.assign(prices, await getKrakenPrices(missing));
  }

  // RATTRAPAGE KRAKEN PAIRE PAR PAIRE.
  //
  // L'appel groupé est du tout ou rien (voir getKrakenPrices) : une seule
  // paire non listée le fait rendre {}, et l'intégralité du lot bascule alors
  // sur Coinbase, qui limite les IP Cloudflare. Interrogées séparément, les
  // paires que Kraken connaît répondent parfaitement — vérifié : SOLUSDT et
  // BNBUSDT rendent leur prix, seules TAOUSDT et POLUSDT sont inconnues.
  //
  // Ce passage ne se déclenche donc QUE quand le groupé a échoué, et il réduit
  // le résidu Coinbase à ce que Kraken ne cote vraiment pas — trois requêtes
  // limitées deviennent zéro.
  missing = pairs.filter((pair) => prices[pairToSymbol(pair)] === undefined);
  if (missing.length > 0 && missing.length === pairs.length) {
    for (let i = 0; i < Math.min(missing.length, MAX_KRAKEN_UNITAIRE); i++) {
      if (i > 0) await sleep(KRAKEN_SPACING_MS);
      let unitaire = await getKrakenPrices([missing[i]]);
      // KRAKEN COTE UNE PARTIE DE L'UNIVERS EN USD, PAS EN USDT.
      //
      // Vérifié contre l'API le 14/08/2026 : ICPUSDT, TAOUSDT et POLUSDT sont
      // inconnues, mais ICPUSD, TAOUSD et POLUSD répondent parfaitement. Le
      // client ne demandait que la cotation USDT et perdait donc ces paires
      // pour rien — la production affichait au même moment :
      //
      //   [post-trade] Aucune source de prix disponible pour ICP/USDT
      //   (Binance/Kraken/Coinbase tous en échec).
      //
      // Un signal dont le prix n'est jamais récupéré ne se CLÔTURE JAMAIS : il
      // reste ouvert au-delà de son échéance et l'abonné n'obtient ni sortie ni
      // résultat. L'écart USD/USDT est de l'ordre du dixième de pour cent —
      // sans commune mesure avec l'absence totale de prix.
      if (Object.keys(unitaire).length === 0) {
        await sleep(KRAKEN_SPACING_MS);
        unitaire = await getKrakenPrices([missing[i]], "USD");
      }
      Object.assign(prices, unitaire);
    }
  }

  // Coinbase ne traite plus que le résidu : les paires que Kraken ne cote pas.
  missing = pairs.filter((pair) => prices[pairToSymbol(pair)] === undefined);
  for (let i = 0; i < missing.length; i++) {
    if (i > 0) await sleep(COINBASE_SPACING_MS);
    const coinbasePrice = await getCoinbasePrice(missing[i]);
    if (coinbasePrice !== null) prices[pairToSymbol(missing[i])] = coinbasePrice;
  }

  for (const pair of pairs) {
    if (prices[pairToSymbol(pair)] === undefined) {
      console.error(`[post-trade] Aucune source de prix disponible pour ${pair} (Binance/Kraken/Coinbase tous en échec).`);
    }
  }

  return prices;
}
