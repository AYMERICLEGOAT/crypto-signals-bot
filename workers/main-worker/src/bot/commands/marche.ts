/**
 * /marche — état EN DIRECT du filtre de tendance du moteur Force Relative.
 *
 * Pourquoi cette commande existe. Le moteur n'émet aucun signal tant que le
 * Bitcoin clôture sous sa moyenne mobile 200 jours (voir
 * signals/relative_strength.py::is_market_in_uptrend). Ce filtre est fermé
 * 41 % du temps, et sa plus longue fermeture a duré 381 jours : sans un
 * endroit où l'abonné peut vérifier lui-même l'état du filtre, un silence de
 * plusieurs mois ressemble à une panne. Il faut pouvoir répondre « le filtre
 * est fermé, voici depuis quand, voici pourquoi » à la demande, avec un
 * chiffre recalculé sur le moment et non un état stocké qui peut être périmé.
 *
 * Le calcul reproduit EXACTEMENT celui du moteur : dernière clôture
 * journalière comparée à la moyenne des 200 dernières clôtures journalières.
 * La bougie du jour en cours est volontairement écartée — elle n'est pas
 * close, sa valeur bouge encore, et l'utiliser ferait dire à cette commande
 * « filtre ouvert » alors que le moteur, qui travaille sur clôtures, n'a
 * encore rien émis. Une commande qui contredit le canal est pire que pas de
 * commande du tout.
 *
 * Récupération des bougies : même cascade et même ordre que
 * market/binancePrices.ts (Binance, puis Kraken, puis Coinbase), pour la même
 * raison — Binance répond 403 aux IP Cloudflare Workers. Ce module-là n'expose
 * que des prix courants, pas d'historique, d'où les quelques constantes
 * reprises ici ; son en-tête reste la référence sur le pourquoi de cet ordre.
 *
 * Si aucune source ne répond, la commande le DIT. Jamais d'état par défaut :
 * annoncer « marché favorable » à tort enverrait l'abonné acheter dans un
 * marché baissier, ce que ce filtre existe précisément pour éviter.
 */

import { Env } from "../../env";
import { sendMessage } from "../../telegram";
import { pairToSymbol } from "../../market/binancePrices";

const BINANCE_BASE_URL = "https://api.binance.com";
const COINBASE_BASE_URL = "https://api.exchange.coinbase.com";
const KRAKEN_BASE_URL = "https://api.kraken.com";

const DAY_MS = 24 * 60 * 60 * 1000;

// Doit rester aligné sur signals/config.py::RS_TREND_MA_PERIOD. Si la période
// change côté moteur sans être changée ici, cette commande annoncerait l'état
// d'un filtre qui n'est pas celui qui décide réellement des envois.
const TREND_MA_PERIOD = 200;

// C'est le RÉGIME DE MARCHÉ qui est mesuré, pas la force d'une paire en
// particulier : le filtre du moteur ne regarde que le Bitcoin.
const BTC_PAIR = "BTC/USDT";

// On demande bien plus que les 200 bougies du calcul : au-delà de l'état
// courant, il faut pouvoir remonter jusqu'au jour de bascule pour répondre
// « depuis quand ». Chaque source a sa propre limite (Binance 1000, Kraken
// ~720, Coinbase 300) ; plus l'historique est profond, plus loin on peut
// dater la bascule, et à défaut on annonce une borne basse honnête.
const BINANCE_HISTORY_LIMIT = 1000;

// Coinbase Exchange bloque parfois les requêtes sans User-Agent explicite
// (déjà observé côté Python, voir signals/coinbase_client.py).
const SOURCE_HEADERS = { "User-Agent": "crypto-signals-bot" };
const SOURCE_MAX_ATTEMPTS = 2;
const SOURCE_RETRY_DELAY_MS = 350;

// Binance n'a droit qu'à UNE tentative, contrairement au repli. Son 403 depuis
// les IP Cloudflare est systématique, pas transitoire : réessayer n'ajoute
// aucune chance de succès et ne fait qu'allonger l'attente de l'abonné, qui
// est ici en train de regarder son écran (à la différence d'un cron).
const BINANCE_MAX_ATTEMPTS = 1;

interface DailyCandle {
  /** Début de la bougie, en millisecondes UTC (minuit UTC pour du journalier). */
  openTimeMs: number;
  close: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format français : virgule décimale, comme tous les chiffres publiés du projet (« -70,9 % »). */
function fr(value: number, decimals = 1): string {
  return value.toFixed(decimals).replace(".", ",");
}

/** Les bougies journalières commencent à minuit UTC ; le Worker tourne en UTC, on l'écrit quand même pour que le jour affiché ne dépende pas du fuseau. */
function frDate(ms: number): string {
  return new Date(ms).toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

async function fetchSource(label: string, url: string, maxAttempts: number): Promise<Response | null> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url, { headers: SOURCE_HEADERS });
      if (res.ok) return res;
      console.error(`[marche] ${label} a répondu ${res.status} (tentative ${attempt}/${maxAttempts})`);
    } catch (err) {
      console.error(`[marche] Erreur ${label} (tentative ${attempt}/${maxAttempts}):`, err);
    }
    if (attempt < maxAttempts) await sleep(SOURCE_RETRY_DELAY_MS * attempt);
  }
  return null;
}

function isUsable(candle: DailyCandle): boolean {
  return Number.isFinite(candle.openTimeMs) && Number.isFinite(candle.close) && candle.close > 0;
}

/** Binance : /klines renvoie [openTime(ms), open, high, low, close, ...]. */
async function getBinanceDailyCandles(): Promise<DailyCandle[]> {
  const url = `${BINANCE_BASE_URL}/api/v3/klines?symbol=${pairToSymbol(BTC_PAIR)}&interval=1d&limit=${BINANCE_HISTORY_LIMIT}`;
  const res = await fetchSource("Binance klines", url, BINANCE_MAX_ATTEMPTS);
  if (!res) return [];
  try {
    const rows = (await res.json()) as unknown[][];
    return rows.map((row) => ({ openTimeMs: Number(row[0]), close: Number(row[4]) })).filter(isUsable);
  } catch (err) {
    console.error("[marche] Réponse Binance klines illisible:", err);
    return [];
  }
}

/**
 * Kraken : /0/public/OHLC avec interval=1440 (journalier), horodatages en
 * SECONDES et [time, open, high, low, close, ...].
 *
 * La clé de la réponse n'est pas celle de la requête — Kraken renvoie ses noms
 * canoniques et appelle le Bitcoin XBT, avec le X/Z hérité de ses paires
 * d'avant 2018. Même rapprochement par préfixe que
 * market/binancePrices.ts::getKrakenPrices. La clé "last" (un simple
 * horodatage) ne correspond à aucun de ces préfixes, elle est donc ignorée
 * sans traitement particulier.
 */
async function getKrakenDailyCandles(): Promise<DailyCandle[]> {
  const alias = "XBT";
  const url = `${KRAKEN_BASE_URL}/0/public/OHLC?pair=${alias}USDT&interval=1440`;
  const res = await fetchSource("Kraken OHLC", url, SOURCE_MAX_ATTEMPTS);
  if (!res) return [];
  try {
    const data = (await res.json()) as { result?: Record<string, unknown> };
    const result = data.result ?? {};
    const key = Object.keys(result).find(
      (k) => k.startsWith(`${alias}USD`) || k.startsWith(`X${alias}ZUSD`) || k.startsWith(`X${alias}USD`),
    );
    const rows = key ? result[key] : undefined;
    if (!Array.isArray(rows)) return [];
    return (rows as unknown[][]).map((row) => ({ openTimeMs: Number(row[0]) * 1000, close: Number(row[4]) })).filter(isUsable);
  } catch (err) {
    console.error("[marche] Réponse Kraken OHLC illisible:", err);
    return [];
  }
}

/** Coinbase Exchange : /candles renvoie [time(s), low, high, open, close, volume], du plus récent au plus ancien (le tri est fait plus loin). */
async function getCoinbaseDailyCandles(): Promise<DailyCandle[]> {
  const productId = `${BTC_PAIR.split("/")[0]}-USD`;
  const url = `${COINBASE_BASE_URL}/products/${productId}/candles?granularity=86400`;
  const res = await fetchSource(`Coinbase ${productId} candles`, url, SOURCE_MAX_ATTEMPTS);
  if (!res) return [];
  try {
    const rows = (await res.json()) as unknown[][];
    return rows.map((row) => ({ openTimeMs: Number(row[0]) * 1000, close: Number(row[4]) })).filter(isUsable);
  } catch (err) {
    console.error("[marche] Réponse Coinbase candles illisible:", err);
    return [];
  }
}

/**
 * Ne garde que les bougies CLOSES, triées du plus ancien au plus récent.
 *
 * Le filtrage se fait sur l'horodatage plutôt qu'en retirant simplement le
 * dernier élément : les trois sources ne sont pas rafraîchies au même rythme,
 * et « la dernière bougie est celle du jour en cours » n'est vrai que chez
 * celles qui ouvrent immédiatement le nouveau seau.
 */
function keepClosedCandles(candles: DailyCandle[]): DailyCandle[] {
  const todayStartMs = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  return candles.filter((candle) => candle.openTimeMs < todayStartMs).sort((a, b) => a.openTimeMs - b.openTimeMs);
}

async function getBtcDailyCandles(): Promise<DailyCandle[]> {
  const sources: Array<() => Promise<DailyCandle[]>> = [getBinanceDailyCandles, getKrakenDailyCandles, getCoinbaseDailyCandles];

  for (const source of sources) {
    const closed = keepClosedCandles(await source());
    // Une source qui répond avec un historique trop court ne permet pas de
    // trancher : on continue la cascade au lieu de calculer une moyenne
    // « 200 jours » sur moins de 200 jours, qui serait un chiffre inventé.
    if (closed.length >= TREND_MA_PERIOD) return closed;
  }
  return [];
}

function movingAverageAt(closes: number[], index: number, period: number): number | null {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index + 1 - period; i <= index; i++) sum += closes[i];
  return sum / period;
}

interface TrendState {
  /** true = filtre ouvert (BTC au-dessus de sa moyenne), false = fermé. */
  open: boolean;
  /** Écart en % entre la dernière clôture et la moyenne, signé. */
  gapPct: number;
  /** Jour de la dernière bougie journalière close utilisée. */
  asOfMs: number;
  /** Premier jour de l'état courant, et sa durée en jours de bourse comptés. */
  sinceMs: number;
  runDays: number;
  /** true quand l'historique disponible s'arrête avant la bascule : la durée est alors une BORNE BASSE, pas la vraie. */
  sinceIsLowerBound: boolean;
}

function computeTrendState(candles: DailyCandle[]): TrendState | null {
  if (candles.length < TREND_MA_PERIOD) return null;

  const closes = candles.map((candle) => candle.close);
  const last = closes.length - 1;
  const ma = movingAverageAt(closes, last, TREND_MA_PERIOD);
  if (ma === null || ma <= 0) return null;

  const open = closes[last] > ma;

  // Remonte le temps tant que l'état ne change pas : le premier jour rencontré
  // sans bascule est le début de la période en cours. La boucle s'arrête à la
  // plus ancienne date où une moyenne 200 jours est calculable ; si elle
  // s'arrête là sans avoir vu de bascule, on ne sait pas depuis quand l'état
  // dure vraiment et on ne l'affirmera pas.
  let runStart = last;
  let flipFound = false;
  for (let i = last - 1; i >= TREND_MA_PERIOD - 1; i--) {
    const maAt = movingAverageAt(closes, i, TREND_MA_PERIOD);
    if (maAt === null) break;
    if ((closes[i] > maAt) !== open) {
      flipFound = true;
      break;
    }
    runStart = i;
  }

  return {
    open,
    gapPct: ((closes[last] - ma) / ma) * 100,
    asOfMs: candles[last].openTimeMs,
    sinceMs: candles[runStart].openTimeMs,
    runDays: last - runStart + 1,
    sinceIsLowerBound: !flipFound,
  };
}

const DISCLAIMER = "⚠️ Signaux informatifs — ni conseil en investissement, ni promesse de gain. Performance passée ne garantit pas les performances futures.";

function buildOpenMessage(state: TrendState): string {
  const duration = state.sinceIsLowerBound
    ? `depuis au moins ${state.runDays} jour${state.runDays > 1 ? "s" : ""} (notre historique de prix ne remonte pas plus loin)`
    : `depuis le ${frDate(state.sinceMs)}, soit ${state.runDays} jour${state.runDays > 1 ? "s" : ""}`;

  return [
    "📈 *Marché favorable — les signaux sont actifs*",
    "",
    `Le Bitcoin clôture ${fr(state.gapPct)} % au-dessus de sa moyenne mobile 200 jours (clôture du ${frDate(state.asOfMs)}). C'est la condition d'ouverture du filtre de tendance, et elle est remplie ${duration}.`,
    "",
    "Ce que ça veut dire concrètement : le moteur classe les 40 paires par force relative, achète les 12 plus fortes et les tient 7 jours. Sur 6 ans, filtre ouvert, ça donne 8,0 signaux par semaine, 47,7 % de gagnants et +3,22 % d'espérance par signal net de frais.",
    "",
    "Le chiffre qui te concerne vraiment, ce n'est pas le rendement de la stratégie mais celui d'une entrée à une date au hasard : après six mois, médiane +5,0 %, 53 % des entrées gagnantes, et pire cas -61,7 %. Après trois mois, médiane 0,0 %, 43 % de gagnantes, pire cas -49,0 %.",
    "",
    "Et le filtre se refermera : il est fermé 41 % du temps. Quand ce sera le cas, tu ne recevras plus rien, et ce sera normal.",
    "",
    DISCLAIMER,
  ].join("\n");
}

function buildClosedMessage(state: TrendState): string {
  const duration = state.sinceIsLowerBound
    ? `Fermé depuis au moins ${state.runDays} jour${state.runDays > 1 ? "s" : ""} — notre historique de prix ne remonte pas plus loin, la vraie durée est donc supérieure.`
    : `Fermé depuis le ${frDate(state.sinceMs)}, soit ${state.runDays} jour${state.runDays > 1 ? "s" : ""}.`;

  return [
    "🚫 *Aucun signal en ce moment — et c'est voulu*",
    "",
    `Le Bitcoin clôture ${fr(Math.abs(state.gapPct))} % SOUS sa moyenne mobile 200 jours (clôture du ${frDate(state.asOfMs)}). Tant que c'est le cas, le canal n'émet aucun signal.`,
    "",
    duration,
    "",
    "*Pourquoi*",
    "La stratégie achète les cryptos les plus fortes du moment : ça ne fonctionne qu'en marché porteur. Sans ce filtre, elle n'est positive que 4 années sur 7. Avec, elle n'a aucune année perdante en 6 ans — non pas parce qu'elle gagne en marché baissier, mais parce qu'en 2022 et en 2026 elle n'a simplement rien émis, pendant que détenir les mêmes cryptos coûtait -70,9 % et -39,4 %.",
    "",
    "C'est le filtre qui fait la majeure partie du travail ; le classement des paires n'ajoute qu'environ 1,1 point. Autrement dit : savoir quand ne PAS acheter compte plus que savoir quoi acheter.",
    "",
    "*Ce que ça coûte*",
    "Ce filtre est fermé 41 % du temps. Sur 6 ans il y a eu 11 fermetures d'au moins une semaine, de 25 jours en médiane, et la plus longue a duré 381 jours — 12,7 mois, du 28/12/2021 au 13/01/2023. Personne ne peut te dire quand celle-ci se terminera.",
    "",
    "On préfère ne rien t'envoyer plutôt que de te faire perdre.",
    "",
    DISCLAIMER,
  ].join("\n");
}

const UNKNOWN_MESSAGE = [
  "❓ *État du marché indéterminé pour le moment*",
  "",
  "Impossible de récupérer les bougies journalières du Bitcoin : aucune de nos trois sources de prix (Binance, Kraken, Coinbase) n'a répondu correctement.",
  "",
  "On préfère te le dire plutôt que d'afficher un état par défaut : annoncer « marché favorable » sans l'avoir vérifié serait exactement le genre d'approximation que ce filtre existe pour éviter. Réessaie dans quelques minutes.",
].join("\n");

/** /marche — état en direct du filtre de tendance (ouvert = signaux actifs, fermé = aucun signal). */
export async function handleMarcheCommand(env: Env, telegramId: number): Promise<void> {
  const candles = await getBtcDailyCandles();
  const state = computeTrendState(candles);

  if (state === null) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, UNKNOWN_MESSAGE, { markdown: true });
    return;
  }

  const text = state.open ? buildOpenMessage(state) : buildClosedMessage(state);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, text, { markdown: true });
}
