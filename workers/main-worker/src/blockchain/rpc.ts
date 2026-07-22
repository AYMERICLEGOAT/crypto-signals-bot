/**
 * Client JSON-RPC minimal pour Polygon, basé sur `fetch`. Remplace ethers.js,
 * qui échoue au chargement sous workerd (import statique de `node:https`
 * dans `geturl.js`, absent du runtime Workers même avec nodejs_compat —
 * vérifié empiriquement, pas une supposition).
 */

export interface JsonRpcConfig {
  url: string;
}

let idCounter = 0;

async function rpcCall<T>(rpc: JsonRpcConfig, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpc.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++idCounter, method, params }),
  });
  if (!res.ok) throw new Error(`RPC Polygon (${method}) a répondu ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC Polygon (${method}): ${json.error.message}`);
  return json.result as T;
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
