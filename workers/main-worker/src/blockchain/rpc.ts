/**
 * Client JSON-RPC minimal pour Polygon, basé sur `fetch`. Remplace ethers.js,
 * qui échoue au chargement sous workerd (import statique de `node:https`
 * dans `geturl.js`, absent du runtime Workers même avec nodejs_compat —
 * vérifié empiriquement, pas une supposition).
 */

import { Env } from "../env";

export interface JsonRpcConfig {
  url: string;
  /** Bloc 15.1 : second nœud public, essayé seulement si `url` échoue après tous ses essais. */
  fallbackUrl?: string;
  /** Appelé (best-effort, jamais bloquant) la première fois que le fallback est réellement utilisé. */
  onFallback?: (error: unknown) => void;
}

// Bloc 15.1 : le nœud principal (POLYGON_RPC_URL) est un nœud public gratuit
// sans SLA -- un second nœud public gratuit, différent, absorbe une
// panne/limite de trafic du premier plutôt que de faire échouer tous les
// paiements USDT le temps qu'il revienne.
//
// DEUXIÈME FOIS QUE CE REPLI MEURT SANS PRÉVENIR.
//
// Audit#30 (30/07) : rpc-mainnet.maticvigil.com était DÉFINITIVEMENT fermé
// (« Our RPC has been shut down »). Remplacé par drpc.org.
//
// 10/08/2026 : drpc.org est mort à son tour — « API key disabled, reason:
// tenant disabled ». Repéré en production parce qu'il renvoyait un HTTP 400
// dont le corps était jeté par le client : les journaux ne montraient que
// « a répondu 400 », sans le motif. Le corps est désormais conservé (voir
// rpcCall) — sans quoi ce diagnostic aurait demandé la même enquête une
// troisième fois.
//
// Tenderly retenu après mesure du 10/08/2026 sur la requête EXACTE de
// production (eth_getLogs, 2 000 blocs, à −40 000 du bloc courant, avec les
// vrais topics). Écartés à la même occasion : llamarpc (aucune réponse),
// 1rpc.io (plafonné à 50 blocs), blockpi (erreur 521), blastapi et
// polygon-pokt (abonnement payant requis), onfinality (limite de débit).
//
// LEÇON, écrite ici parce qu'elle se répétera : un nœud public gratuit ferme
// sans préavis. Ce n'est pas une anomalie, c'est le régime normal. La seule
// protection durable est que l'échec soit LISIBLE dans les journaux.
const FALLBACK_POLYGON_RPC_URL = "https://polygon.gateway.tenderly.co";

/**
 * Construit la config RPC Polygon standard : nœud principal, nœud de secours,
 * et journalisation de la bascule.
 *
 * L'alerte Telegram qui accompagnait cette bascule a été RETIRÉE le 10/08/2026
 * — voir le commentaire sur `onFallback` ci-dessous. Elle avait d'abord été
 * déduplique à une par heure parce qu'elle partait à chaque cycle de cinq
 * minutes ; la déduplication traitait le symptôme. Le vrai défaut était
 * qu'elle annonçait le bon fonctionnement du repli.
 */
export function buildPolygonRpcConfig(env: Env): JsonRpcConfig {
  return {
    url: env.POLYGON_RPC_URL,
    fallbackUrl: FALLBACK_POLYGON_RPC_URL,
    // UNE BASCULE RÉUSSIE N'EST PAS UN INCIDENT, ET NE DOIT PLUS ALERTER.
    //
    // Ce rappel partait toutes les heures, indéfiniment, pour annoncer que le
    // système de secours avait FONCTIONNÉ. Trois défauts dans la même alerte :
    //
    //   1. Elle n'appelle aucune action. Les nœuds publics limitent les IP
    //      Cloudflare de façon intermittente ; le propriétaire ne peut rien y
    //      faire, et il n'y a rien à réparer puisque le repli a tenu.
    //   2. Elle décrit un succès. « Bascule sur le nœud de secours » signifie
    //      que la redondance a joué son rôle exactement comme prévu.
    //   3. Elle use le canal d'alerte. Une alerte non actionnable répétée
    //      apprend à ignorer les alertes — et le jour où un vrai problème de
    //      paiement arrive, il tombe dans un canal que plus personne ne lit.
    //
    // La bascule reste journalisée : le diagnostic garde sa trace. Ce qui
    // mérite VRAIMENT une alerte est l'échec des DEUX nœuds, c'est-à-dire le
    // moment où la détection des paiements s'arrête réellement — et ce cas-là
    // remonte déjà par l'erreur du cron (voir cron/pollPayments.ts, qui
    // journalise une fois par panne et rappelle toutes les six heures).
    onFallback: (error) => {
      console.warn(`[rpc] Bascule sur le RPC Polygon de secours (${FALLBACK_POLYGON_RPC_URL}), primaire en échec:`, error);
    },
  };
}

let idCounter = 0;

// Retry (Bloc 8) : POLYGON_RPC_URL est un nœud public gratuit, plus sujet aux
// erreurs transitoires (429, 5xx, coupure réseau) qu'un endpoint dédié. Ne
// réessaie QUE les échecs de transport/HTTP, jamais une erreur JSON-RPC
// applicative (params invalides, etc.) — celle-là ne se corrigera pas en
// réessayant la même requête.
const RPC_MAX_ATTEMPTS = 3;
const RPC_RETRY_BASE_DELAY_MS = 400;

/** Erreur JSON-RPC applicative (params invalides, etc.) : ne se corrige jamais en réessayant ou en changeant de nœud. */
class RpcApplicationError extends Error {}

async function attemptUrl<T>(url: string, method: string, params: unknown[]): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RPC_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++idCounter, method, params }),
      });
    } catch (err) {
      lastError = err;
      if (attempt === RPC_MAX_ATTEMPTS) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, RPC_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
      continue;
    }

    if (!res.ok) {
      // LE CORPS DE LA RÉPONSE EST CONSERVÉ, et ce n'est pas cosmétique.
      //
      // L'erreur ne disait que « a répondu 400 », ce qui n'apprend rien : le
      // motif réel — « History has been pruned for this block », une limite de
      // débit, une plage trop large — vit dans le corps, et il était jeté. Deux
      // conséquences : impossible de diagnostiquer depuis les journaux, et
      // impossible pour un appelant de DISTINGUER une panne définitive d'une
      // panne transitoire. Or usdtTransfers a précisément besoin de cette
      // distinction : avancer sur un élagage, réessayer sur le reste.
      const corps = await res.text().catch(() => "");
      lastError = new Error(`RPC Polygon (${method}) a répondu ${res.status}: ${corps.slice(0, 300)}`);
      if (attempt === RPC_MAX_ATTEMPTS) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, RPC_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
      continue;
    }

    const json = (await res.json()) as { result?: T; error?: { message: string } };
    if (json.error) throw new RpcApplicationError(`RPC Polygon (${method}): ${json.error.message}`);
    return json.result as T;
  }

  throw lastError;
}

/**
 * Bloc 15.1 : si `rpc.fallbackUrl` est fourni, un échec de transport/HTTP du
 * nœud principal (jamais une erreur JSON-RPC applicative, qui échouerait
 * pareil sur n'importe quel nœud) déclenche un essai sur le nœud de secours
 * avant d'abandonner définitivement.
 */
async function rpcCall<T>(rpc: JsonRpcConfig, method: string, params: unknown[]): Promise<T> {
  try {
    return await attemptUrl<T>(rpc.url, method, params);
  } catch (err) {
    if (err instanceof RpcApplicationError || !rpc.fallbackUrl) throw err;
    rpc.onFallback?.(err);
    return attemptUrl<T>(rpc.fallbackUrl, method, params);
  }
}

export interface RpcLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

export async function getBlockNumber(rpc: JsonRpcConfig): Promise<number> {
  const hex = await rpcCall<string>(rpc, "eth_blockNumber", []);
  return parseInt(hex, 16);
}

export async function getLogs(
  rpc: JsonRpcConfig,
  params: { address: string; topics: (string | null)[]; fromBlock: number; toBlock: number }
): Promise<RpcLog[]> {
  return rpcCall<RpcLog[]>(rpc, "eth_getLogs", [
    {
      address: params.address,
      topics: params.topics,
      fromBlock: "0x" + params.fromBlock.toString(16),
      toBlock: "0x" + params.toBlock.toString(16),
    },
  ]);
}
