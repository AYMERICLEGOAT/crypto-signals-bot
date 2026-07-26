/**
 * Client JSON-RPC minimal pour Polygon, basé sur `fetch`. Remplace ethers.js,
 * qui échoue au chargement sous workerd (import statique de `node:https`
 * dans `geturl.js`, absent du runtime Workers même avec nodejs_compat —
 * vérifié empiriquement, pas une supposition).
 */

import { Env, dbConfig } from "../env";
import { sendMessage } from "../telegram";
import { shouldAlertRpcFallback, recordRpcFallbackAlert } from "../db/rpcHealthAlerts";

export interface JsonRpcConfig {
  url: string;
  /** Bloc 15.1 : second nœud public, essayé seulement si `url` échoue après tous ses essais. */
  fallbackUrl?: string;
  /** Appelé (best-effort, jamais bloquant) la première fois que le fallback est réellement utilisé. */
  onFallback?: (error: unknown) => void;
}

// Bloc 15.1 : polygon-rpc.com est un nœud public gratuit sans SLA -- un
// second nœud public gratuit, différent, absorbe une panne/limite de trafic
// du premier plutôt que de faire échouer tous les paiements USDT le temps
// que polygon-rpc.com revienne.
const FALLBACK_POLYGON_RPC_URL = "https://rpc-mainnet.maticvigil.com";

/**
 * Construit la config RPC Polygon standard (nœud principal + fallback +
 * alerte canal admin). L'alerte est déduplique (voir db/rpcHealthAlerts.ts)
 * -- observé en production : sans ça, le cron de 5 minutes renvoyait une
 * alerte identique à chaque cycle tant que le nœud principal restait en
 * panne (7+ messages en 30 minutes pour la même panne, jamais résolue).
 */
export function buildPolygonRpcConfig(env: Env): JsonRpcConfig {
  return {
    url: env.POLYGON_RPC_URL,
    fallbackUrl: FALLBACK_POLYGON_RPC_URL,
    onFallback: (error) => {
      console.warn(`[rpc] Bascule sur le RPC Polygon de secours (${FALLBACK_POLYGON_RPC_URL}), primaire en échec:`, error);
      if (!env.ADMIN_TELEGRAM_ID) return;

      const db = dbConfig(env);
      shouldAlertRpcFallback(db)
        .then((shouldAlert) => {
          if (!shouldAlert) return;
          return sendMessage(
            env.TELEGRAM_BOT_TOKEN,
            Number(env.ADMIN_TELEGRAM_ID),
            `⚠️ RPC Polygon principal (${env.POLYGON_RPC_URL}) en échec, bascule sur le nœud de secours. ` +
              "(prochain rappel dans au moins 1h si la panne persiste, pas à chaque cycle)"
          ).then(() => recordRpcFallbackAlert(db));
        })
        .catch((err) => console.error("[rpc] Échec de la vérification/notification de bascule RPC:", err));
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
      lastError = new Error(`RPC Polygon (${method}) a répondu ${res.status}`);
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

export async function ethCall(rpc: JsonRpcConfig, to: string, data: string): Promise<string> {
  return rpcCall<string>(rpc, "eth_call", [{ to, data }, "latest"]);
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

/** "pending" plutôt que "latest" pour tenir compte des transactions déjà envoyées mais pas encore minées. */
export async function getTransactionCount(rpc: JsonRpcConfig, address: string): Promise<number> {
  const hex = await rpcCall<string>(rpc, "eth_getTransactionCount", [address, "pending"]);
  return parseInt(hex, 16);
}

export async function getGasPrice(rpc: JsonRpcConfig): Promise<bigint> {
  const hex = await rpcCall<string>(rpc, "eth_gasPrice", []);
  return BigInt(hex);
}

export async function getChainId(rpc: JsonRpcConfig): Promise<bigint> {
  const hex = await rpcCall<string>(rpc, "eth_chainId", []);
  return BigInt(hex);
}

export async function sendRawTransaction(rpc: JsonRpcConfig, rawTxHex: string): Promise<string> {
  return rpcCall<string>(rpc, "eth_sendRawTransaction", [rawTxHex]);
}

export interface RpcReceipt {
  status: string; // "0x1" = succès, "0x0" = échec
  blockNumber: string;
}

export async function getTransactionReceipt(rpc: JsonRpcConfig, txHash: string): Promise<RpcReceipt | null> {
  return rpcCall<RpcReceipt | null>(rpc, "eth_getTransactionReceipt", [txHash]);
}
