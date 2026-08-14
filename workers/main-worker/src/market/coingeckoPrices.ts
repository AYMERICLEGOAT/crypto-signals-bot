/**
 * DERNIER RECOURS DE PRIX : CoinGecko.
 *
 * Ce fichier existe à cause d'une position réellement bloquée. Le 14/08/2026,
 * les journaux du cron répétaient à chaque cycle :
 *
 *   [post-trade] Aucune source de prix disponible pour MKR/USDT
 *   (Binance/Kraken/Coinbase tous en échec).
 *
 * Trois sources, trois raisons différentes, toutes définitives :
 *   - Binance répond 403 aux IP de sortie Cloudflare (blocage d'hébergeur) ;
 *   - Kraken ne cote MKR sous AUCUNE cotation, USD comprise ;
 *   - Coinbase répond « Not allowed for delisted products ».
 *
 * Or MKR est parfaitement tradable, et le générateur Python le price sans
 * difficulté. Ce n'était donc pas la paire qui posait problème : c'était la
 * cécité de NOTRE infrastructure. Un signal dont le prix n'est jamais récupéré
 * ne se clôture jamais — il reste ouvert au-delà de son échéance, l'abonné
 * n'obtient ni sortie ni résultat, et la promesse de republication du canal
 * gratuit ne peut pas être tenue.
 *
 * L'ancien commentaire du client de prix écartait CoinGecko en disant qu'il
 * « demande un mapping id-par-actif que cette source de secours ne justifie
 * pas ». C'était vrai tant qu'aucune paire n'échappait aux trois autres. Et le
 * mapping n'était même pas à écrire : le projet le maintient déjà depuis le
 * début dans signals/config.py::PAIRS. Il est simplement recopié ici.
 *
 * IL FAUT LES DEUX FICHIERS EN PHASE. Une paire ajoutée à config.PAIRS sans
 * son entrée ici redeviendrait intraçable — c'est-à-dire signalable mais
 * jamais clôturable. C'est le défaut que ce module répare, et le seul moyen de
 * le faire revenir.
 */

/** Symbole de base -> identifiant CoinGecko. Copie de signals/config.py::PAIRS. */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  POL: "polygon-ecosystem-token",
  LTC: "litecoin",
  SHIB: "shiba-inu",
  UNI: "uniswap",
  ATOM: "cosmos",
  NEAR: "near",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  SUI: "sui",
  FET: "fetch-ai",
  PEPE: "pepe",
  RENDER: "render-token",
  INJ: "injective-protocol",
  TIA: "celestia",
  TAO: "bittensor",
  STX: "blockstack",
  FIL: "filecoin",
  VET: "vechain",
  ALGO: "algorand",
  ICP: "internet-computer",
  ETC: "ethereum-classic",
  HBAR: "hedera-hashgraph",
  XLM: "stellar",
  AAVE: "aave",
  MKR: "maker",
  GRT: "the-graph",
  SAND: "the-sandbox",
  EOS: "eos",
  CHZ: "chiliz",
};

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price";

/**
 * Prix pour les paires demandées, en UN seul appel.
 *
 * CoinGecko accepte une liste d'identifiants séparés par des virgules, et son
 * API publique n'exige aucune clé. Ce recours n'est atteint que par le résidu
 * — les paires qu'aucune des trois bourses n'a servies — donc au plus une
 * requête par cycle, en pratique zéro.
 */
export async function getCoinGeckoPrices(pairs: string[]): Promise<Record<string, number>> {
  const connues = pairs
    .map((pair) => ({ pair, base: pair.split("/")[0] }))
    .filter((p) => COINGECKO_IDS[p.base]);
  if (connues.length === 0) return {};

  const ids = [...new Set(connues.map((p) => COINGECKO_IDS[p.base]))].join(",");
  try {
    const res = await fetch(`${COINGECKO_URL}?ids=${encodeURIComponent(ids)}&vs_currencies=usd`, {
      headers: { "User-Agent": "crypto-signals-bot" },
    });
    if (!res.ok) {
      console.error(`[post-trade] CoinGecko a répondu ${res.status} pour ${ids}.`);
      return {};
    }
    const data = (await res.json()) as Record<string, { usd?: number }>;
    const out: Record<string, number> = {};
    for (const { pair, base } of connues) {
      const valeur = data[COINGECKO_IDS[base]]?.usd;
      if (typeof valeur === "number" && Number.isFinite(valeur) && valeur > 0) {
        out[pair.replace("/", "")] = valeur;
      }
    }
    return out;
  } catch (err) {
    console.error("[post-trade] CoinGecko injoignable :", err);
    return {};
  }
}
