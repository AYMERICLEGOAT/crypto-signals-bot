/**
 * /marche — état EN DIRECT du filtre de tendance des familles directionnelles.
 *
 * Pourquoi cette commande existe. Les trois familles directionnelles (force
 * relative, cassure de canal, expansion de volatilité) n'émettent rien tant que
 * le Bitcoin clôture sous sa moyenne mobile 200 jours (voir
 * signals/relative_strength.py::is_market_in_uptrend). Ce filtre est fermé
 * 41 % du temps, et sa plus longue fermeture a duré 381 jours : sans un
 * endroit où l'abonné peut vérifier lui-même l'état du filtre, un silence de
 * plusieurs mois ressemble à une panne. Il faut pouvoir répondre « le filtre
 * est fermé, voici depuis quand, voici pourquoi » à la demande, avec un
 * chiffre recalculé sur le moment et non un état stocké qui peut être périmé.
 *
 * Correction du 04/08/2026 — la plus importante de ce fichier. Ce message
 * décrivait un moteur à UNE famille : filtre fermé signifiait donc « rien ne
 * fonctionne ». C'est faux depuis l'ajout du carry de financement (voir
 * signals/carry_engine.py), qui n'est PAS filtré parce qu'il ne parie sur
 * aucune direction — il ouvre deux jambes qui s'annulent et encaisse le
 * financement. Laisser croire à un abonné, un jour de filtre fermé, que le
 * produit entier est à l'arrêt, c'est lui cacher les deux familles qui produisent
 * précisément ce jour-là. Les deux messages nomment donc explicitement ce qui
 * s'arrête ET ce qui continue, et la commande va lire en base les carrys
 * réellement ouverts : un fait vérifiable vaut mieux qu'une affirmation.
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

import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { pairToSymbol } from "../../market/binancePrices";
import { getOpenCarrySignals } from "../../db/signals";

const BINANCE_BASE_URL = "https://api.binance.com";
const COINBASE_BASE_URL = "https://api.exchange.coinbase.com";
const KRAKEN_BASE_URL = "https://api.kraken.com";

const DAY_MS = 24 * 60 * 60 * 1000;

// Doit rester aligné sur signals/config.py::RS_TREND_MA_PERIOD. Si la période
// change côté moteur sans être changée ici, cette commande annoncerait l'état
// d'un filtre qui n'est pas celui qui décide réellement des envois.
const TREND_MA_PERIOD = 200;

// C'est le RÉGIME DE MARCHÉ qui est mesuré, pas la force d'une paire en
// particulier : le filtre du moteur ne regarde que le Bitcoin. Et il ne
// commande QUE les trois familles directionnelles — le carry de financement
// tourne dans les deux régimes (voir signals/carry_engine.py), et le momentum
// 4H ne tourne QUE quand le filtre est fermé (voir signals/momentum_4h.py).
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

// Description du carry répétée dans les deux états du filtre : c'est la seule
// famille qui tourne dans les deux, et l'abonné qui tape /marche un jour de
// fermeture doit la lire au moment exact où il croit que tout est à l'arrêt.
const CARRY_EXPLANATION =
  "Le carry de financement, lui, n'est pas filtré — et c'est volontaire. Il ne parie sur aucune direction : " +
  "il ouvre deux jambes du même montant sur la même crypto, un achat au comptant et une vente à découvert du " +
  "perpétuel. Ce que l'une gagne, l'autre le perd : le prix ne rentre pas dans l'équation. Ce qui est encaissé, " +
  "c'est le financement, versé toutes les huit heures par les acheteurs de perpétuels aux vendeurs.";

const CARRY_RISK =
  "Ce n'est pas « sans risque », et on ne l'écrira jamais. La jambe vendeuse peut être liquidée si la marge " +
  "devient insuffisante, et il reste un risque de plateforme. La pire position mesurée sur ces 6 ans a perdu 19,86 %.";

// Le momentum 4H ne travaille QUE filtre fermé : il n'a donc sa place que dans
// le message de fermeture. Annoncé pour ce qu'il est — un moteur en observation
// — parce qu'un abonné qui découvre qu'on lui a caché la fraction incertaine du
// produit ne revient pas.
const MOMENTUM_4H_EXPLANATION =
  "Et depuis peu, un second moteur travaille précisément dans ce régime : le momentum 4H. Il ne cherche pas de " +
  "croisement d'indicateurs — il classe toutes les cryptos suivies les unes contre les autres sur des bougies de " +
  "4 heures, et achète les deux plus fortes du moment, tenues 3 jours.\n" +
  "Il est *en observation*, et c'est écrit sur chacun de ses signaux : mesuré positif trois années sur quatre, mais " +
  "en recul sur la dernière. Deux places par jour au maximum, jamais plus, et il s'arrêtera de lui-même si ses " +
  "résultats réels démentent la mesure. À dimensionner plus petit que les autres.";

/**
 * Les carrys réellement ouverts, lus en base au moment de la commande.
 *
 * Pourquoi aller chercher ça plutôt que de l'affirmer en texte : un jour de
 * filtre fermé, « le carry continue » est exactement le genre de phrase qu'un
 * visiteur méfiant lit comme une excuse commerciale. Trois noms de cryptos
 * qu'il peut vérifier sur n'importe quelle plateforme, non.
 *
 * Toute erreur est avalée : cette commande doit répondre sur l'état du filtre
 * même si Supabase hoquette. Mieux vaut une ligne en moins qu'un /marche muet.
 */
async function buildOpenCarryLine(env: Env): Promise<string | null> {
  try {
    const carries = await getOpenCarrySignals(dbConfig(env));
    if (carries.length === 0) return null;
    // On n'affiche que la base de la paire (ZRO plutôt que ZRO/USDT) : c'est
    // la crypto qui parle à l'abonné, la contrepartie en dollars est implicite.
    const pairs = carries.map((signal) => signal.pair.split("/")[0]).join(", ");
    return carries.length === 1
      ? `👉 En ce moment, 1 carry est ouvert : ${pairs}.`
      : `👉 En ce moment, ${carries.length} carrys sont ouverts : ${pairs}.`;
  } catch (err) {
    console.error("[marche] Lecture des carrys ouverts impossible:", err);
    return null;
  }
}

function joinLines(lines: Array<string | null>): string {
  return lines.filter((line): line is string => line !== null).join("\n");
}

function buildOpenMessage(state: TrendState, carryLine: string | null): string {
  const duration = state.sinceIsLowerBound
    ? `depuis au moins ${state.runDays} jour${state.runDays > 1 ? "s" : ""} (notre historique de prix ne remonte pas plus loin)`
    : `depuis le ${frDate(state.sinceMs)}, soit ${state.runDays} jour${state.runDays > 1 ? "s" : ""}`;

  return joinLines([
    "📈 *Marché favorable — les quatre familles émettent*",
    "",
    `Le Bitcoin clôture ${fr(state.gapPct)} % au-dessus de sa moyenne mobile 200 jours (clôture du ${frDate(state.asOfMs)}). C'est la condition d'ouverture du filtre de tendance, et elle est remplie ${duration}.`,
    "",
    "*Ce qui tourne*",
    "Trois familles directionnelles : la force relative (les 40 paires suivies sont classées, on achète les 12 plus fortes et on les tient 7 jours), la cassure du plus haut 50 jours, et l'expansion de volatilité après une phase de compression.",
    "",
    CARRY_EXPLANATION,
    carryLine,
    "",
    "*Le débit mesuré*",
    "• dans un marché comme aujourd'hui : 4,35 signaux par jour",
    "• quand le filtre se referme : le carry prend le relais, accompagné du momentum 4H qui ne travaille que dans ce régime-là",
    "• au total, jamais plus de 5 par jour : au-delà, ce ne serait plus une sélection",
    "",
    "*Ce qu'il faut savoir sur les signaux directionnels*",
    "Ils réussissent environ une fois sur deux, et le signal médian PERD 0,69 %. Tout le résultat vient d'une minorité de gros gagnants : il faut donc les prendre TOUS. En trier quelques-uns revient statistiquement à ne garder que la partie perdante.",
    "",
    "Le chiffre qui te concerne vraiment, ce n'est pas le rendement de la stratégie mais celui d'une entrée à une date au hasard : après six mois, médiane +5,0 %, 53 % des entrées gagnantes, et pire cas -61,7 %.",
    "",
    "Et le filtre se refermera : il est fermé 41 % du temps, jusqu'à 381 jours d'affilée. Ce jour-là, les trois familles directionnelles se tairont, et le carry ainsi que le momentum 4H prendront le relais. Ce sera normal, et /marche te le dira.",
    "",
    DISCLAIMER,
  ]);
}

function buildClosedMessage(state: TrendState, carryLine: string | null): string {
  const duration = state.sinceIsLowerBound
    ? `Fermé depuis au moins ${state.runDays} jour${state.runDays > 1 ? "s" : ""} — notre historique de prix ne remonte pas plus loin, la vraie durée est donc supérieure.`
    : `Fermé depuis le ${frDate(state.sinceMs)}, soit ${state.runDays} jour${state.runDays > 1 ? "s" : ""}.`;

  return joinLines([
    "🔻 *Filtre de tendance fermé — mais le canal n'est pas muet*",
    "",
    `Le Bitcoin clôture ${fr(Math.abs(state.gapPct))} % SOUS sa moyenne mobile 200 jours (clôture du ${frDate(state.asOfMs)}).`,
    duration,
    "",
    "*Ce qui s'arrête*",
    "Les trois familles directionnelles — force relative, cassure du plus haut 50 jours, expansion de volatilité — n'émettent plus rien. Elles achètent, et acheter ne paie pas dans ce régime. On préfère ne rien t'envoyer plutôt que de te faire perdre.",
    "",
    "*Ce qui continue*",
    CARRY_EXPLANATION,
    carryLine,
    "",
    MOMENTUM_4H_EXPLANATION,
    "",
    "*Les chiffres mesurés*",
    "• dans un marché comme aujourd'hui : le carry (1,15 par jour) plus le momentum 4H (jusqu'à 2 par jour)",
    "• dans un marché favorable : 4,35 par jour, les familles directionnelles réunies",
    "• au total, jamais plus de 5 signaux par jour : au-delà, ce ne serait plus une sélection",
    "• carry seul : 84,2 % de positions gagnantes, +0,572 % net par position, six années positives sur sept — la septième, 2022, est à -0,046 %, donc plate et non perdante",
    "",
    "*Ce que ce n'est pas*",
    CARRY_RISK,
    "",
    "Quant au filtre directionnel, il est fermé 41 % du temps. La plus longue fermeture a duré 381 jours, du 28/12/2021 au 13/01/2023, et personne ne peut te dire quand celle-ci se terminera. C'est exactement pour ces périodes-là que le carry existe.",
    "",
    DISCLAIMER,
  ]);
}

function buildUnknownMessage(carryLine: string | null): string {
  return joinLines([
    "❓ *État du filtre indéterminé pour le moment*",
    "",
    "Impossible de récupérer les bougies journalières du Bitcoin : aucune de nos trois sources de prix (Binance, Kraken, Coinbase) n'a répondu correctement.",
    "",
    "On préfère te le dire plutôt que d'afficher un état par défaut : annoncer « marché favorable » sans l'avoir vérifié serait exactement le genre d'approximation que ce filtre existe pour éviter. Réessaie dans quelques minutes.",
    "",
    // Même en cas de panne de prix, ce point reste vrai et vérifiable en base :
    // ne pas le dire laisserait croire que tout le produit est hors service.
    "À noter : ce filtre coupe les trois familles directionnelles, mais il ne met pas le produit à l'arrêt. Le carry de financement, neutre au marché, ne dépend ni de cette moyenne ni de ces sources de prix ; et le momentum 4H, lui, ne se déclenche QUE quand le filtre est fermé.",
    carryLine,
  ]);
}

/**
 * /marche — état en direct du filtre de tendance.
 *
 * Ouvert = les quatre familles émettent. Fermé = les trois directionnelles se
 * taisent, le carry continue. Aucun des deux états ne signifie « le canal
 * n'envoie rien ».
 */
export async function handleMarcheCommand(env: Env, telegramId: number): Promise<void> {
  // Les carrys ouverts sont lus dans tous les cas, y compris quand les sources
  // de prix tombent : c'est justement le message le plus utile ce jour-là.
  const [candles, carryLine] = await Promise.all([getBtcDailyCandles(), buildOpenCarryLine(env)]);
  const state = computeTrendState(candles);

  if (state === null) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, buildUnknownMessage(carryLine), { markdown: true });
    return;
  }

  const text = state.open ? buildOpenMessage(state, carryLine) : buildClosedMessage(state, carryLine);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, text, { markdown: true });
}
