/**
 * État du FILTRE DE TENDANCE ABSOLUE : le Bitcoin est-il au-dessus ou en
 * dessous de sa moyenne mobile 200 jours ?
 *
 * Pourquoi ce module existe côté Worker. La règle elle-même vit dans le moteur
 * Python (signals/relative_strength.py::is_market_in_uptrend) et c'est LUI qui
 * décide d'émettre ou non — rien ici ne pilote la stratégie. Mais le canal
 * public doit pouvoir EXPLIQUER son silence, et le moteur ne persiste nulle
 * part l'état du filtre : le Worker ne voit que l'absence de signaux, ce qui ne
 * distingue pas « le filtre est fermé » (normal, attendu, explicable) d'une
 * panne du générateur. Publier « le marché est sous sa moyenne 200 jours »
 * sans l'avoir vérifié serait exactement le genre d'affirmation non mesurée que
 * ce projet s'interdit — d'où ce recalcul indépendant.
 *
 * Méthode, alignée sur le moteur pour que les deux ne se contredisent pas :
 *   - bougies JOURNALIÈRES, moyenne simple sur 200 clôtures ;
 *   - la bougie du jour EN COURS est écartée. C'est le détail qui compte : le
 *     moteur travaille sur des bougies closes, et inclure une journée partielle
 *     déplace l'écart. Vérifié le 03/08/2026 sur les deux sources — en excluant
 *     la journée en cours, Kraken et Coinbase donnent tous deux -10,7 %, valeur
 *     identique à celle du moteur ; en l'incluant, on obtenait -10,3 %.
 *
 * Sources : Kraken d'abord, Coinbase en repli. Binance est volontairement
 * absent : il répond 403 aux IP Cloudflare Workers (constat de production du
 * 03/08, voir market/binancePrices.ts) — l'appeler ne ferait que dépenser une
 * sous-requête pour rien.
 *
 * En cas d'échec, ce module retourne `null` plutôt qu'une supposition. Même
 * logique que `is_market_in_uptrend` qui retourne None quand l'historique est
 * trop court : sans information fiable sur le régime de marché, on n'affirme
 * rien. L'appelant doit alors se rabattre sur un texte qui ne décrit pas
 * l'état du marché.
 */

// Doit rester aligné sur signals/config.py::RS_TREND_MA_PERIOD.
const MA_PERIOD = 200;

const KRAKEN_URL = "https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1440";
const COINBASE_URL = "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400";

// Coinbase Exchange bloque les requêtes sans User-Agent explicite (déjà observé
// côté Python, voir signals/coinbase_client.py).
const HEADERS = { "User-Agent": "crypto-signals-bot" };

export interface TrendFilterState {
  /** true si le Bitcoin clôture SOUS sa moyenne 200 jours : aucun signal n'est émis. */
  isClosed: boolean;
  /** Écart entre la dernière clôture et la moyenne 200 jours, en %. Négatif = sous la moyenne. */
  gapPct: number;
  /**
   * Nombre de jours consécutifs passés sous la moyenne, `null` si indéterminable.
   *
   * Calculé sur la série, jamais écrit en dur. Une date de début de fermeture
   * codée dans le fichier serait juste le jour où on l'écrit puis fausse pour
   * toujours — c'est précisément le mécanisme qui a laissé un « 61,2 % de
   * réussite » affiché pendant des mois. Ici la valeur se recalcule seule et
   * repart de zéro à la réouverture suivante.
   *
   * `null` quand la série est trop courte pour remonter jusqu'au début de la
   * fermeture (cas du repli Coinbase, qui plafonne à 300 bougies donc ~100
   * jours de moyenne calculable) : annoncer un compteur tronqué reviendrait à
   * SOUS-estimer la durée réelle, donc à embellir. Mieux vaut ne rien dire.
   */
  closedDays: number | null;
}

/** Début de la journée UTC en cours, en secondes — borne d'exclusion de la bougie partielle. */
function startOfTodayUtcSeconds(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
}

/**
 * Kraken : `/0/public/OHLC` renvoie jusqu'à 720 bougies journalières, largement
 * de quoi couvrir 200 clôtures. La clé du résultat n'est pas celle demandée
 * (Kraken renvoie son nom canonique, `XXBTZUSD` pour BTC/USD) : on prend donc
 * la seule clé qui n'est pas `last`. Colonnes : [temps, open, high, low, close…].
 */
async function fetchKrakenDailyCloses(): Promise<number[]> {
  const res = await fetch(KRAKEN_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Kraken OHLC a répondu ${res.status}`);

  const data = (await res.json()) as { result?: Record<string, unknown> };
  const result = data.result ?? {};
  const key = Object.keys(result).find((k) => k !== "last");
  if (!key) throw new Error("Kraken OHLC : aucune série dans la réponse");

  const rows = result[key] as (string | number)[][];
  const cutoff = startOfTodayUtcSeconds();
  return rows
    .filter((row) => Number(row[0]) < cutoff)
    .map((row) => Number(row[4]))
    .filter((close) => Number.isFinite(close) && close > 0);
}

/**
 * Coinbase : `/candles?granularity=86400` renvoie au plus 300 bougies (assez
 * pour 200), de la PLUS RÉCENTE à la plus ancienne — d'où l'inversion, sans
 * laquelle la moyenne porterait sur les 200 plus vieilles clôtures. Colonnes :
 * [temps, low, high, open, close, volume], donc la clôture est bien en 4.
 */
async function fetchCoinbaseDailyCloses(): Promise<number[]> {
  const res = await fetch(COINBASE_URL, { headers: HEADERS });
  if (!res.ok) throw new Error(`Coinbase candles a répondu ${res.status}`);

  const rows = (await res.json()) as number[][];
  const cutoff = startOfTodayUtcSeconds();
  return rows
    .filter((row) => Number(row[0]) < cutoff)
    .map((row) => Number(row[4]))
    .filter((close) => Number.isFinite(close) && close > 0)
    .reverse();
}

function computeState(closes: number[]): TrendFilterState | null {
  if (closes.length < MA_PERIOD) return null;

  // Somme glissante : une moyenne par jour exploitable, du plus ancien au plus
  // récent. `belowByDay[i]` dit si ce jour-là la clôture était sous sa moyenne.
  const belowByDay: boolean[] = [];
  let sum = 0;
  let lastMa = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= MA_PERIOD) sum -= closes[i - MA_PERIOD];
    if (i < MA_PERIOD - 1) continue;
    lastMa = sum / MA_PERIOD;
    belowByDay.push(closes[i] < lastMa);
  }
  if (!Number.isFinite(lastMa) || lastMa <= 0) return null;

  const last = closes[closes.length - 1];
  const isClosed = last < lastMa;

  // Longueur de la série de fermeture en cours, en remontant le temps.
  let streak = 0;
  for (let i = belowByDay.length - 1; i >= 0 && belowByDay[i]; i--) streak++;

  // La série bute sur le bord de l'historique disponible : la fermeture a
  // commencé avant ce que les données permettent de voir, le compteur serait
  // donc un minorant présenté comme un total. On préfère ne pas le publier.
  const closedDays = isClosed && streak < belowByDay.length ? streak : null;

  return { isClosed, gapPct: (last / lastMa - 1) * 100, closedDays };
}

/**
 * Retourne l'état du filtre, ou `null` si aucune source n'a pu être exploitée.
 *
 * Appelé au plus une fois par jour (l'appelant est protégé par un drapeau
 * « déjà publié aujourd'hui »), donc le coût en sous-requêtes est négligeable
 * pour le budget du Worker.
 */
export async function getTrendFilterState(): Promise<TrendFilterState | null> {
  for (const [name, fetchCloses] of [
    ["Kraken", fetchKrakenDailyCloses],
    ["Coinbase", fetchCoinbaseDailyCloses],
  ] as const) {
    try {
      const state = computeState(await fetchCloses());
      if (state) return state;
      console.error(`[trend-filter] ${name} : historique journalier insuffisant (${MA_PERIOD} clôtures requises).`);
    } catch (err) {
      console.error(`[trend-filter] Échec ${name} :`, err);
    }
  }

  console.error("[trend-filter] Aucune source disponible : état du filtre indéterminé, aucune affirmation publiée.");
  return null;
}
