/**
 * Surveillance des transferts USDT (ERC20 `Transfer`) entrants vers l'adresse
 * de réception configurée (PAYMENT_ADDRESS_USDT) — remplace l'écoute de
 * l'événement `Subscribed` du smart contract pour le flux 100% off-chain
 * (V2). Même principe de rattrapage par checkpoint que subscriptionEvents.ts,
 * avec sa propre clé dans `chain_state` pour ne pas interférer avec elle.
 */

import { Env } from "../env";
import { getBlockNumber, getLogs } from "./rpc";
import { TRANSFER_TOPIC0, decodeAddressFromTopic, decodeUint256, encodeAddressArg } from "./abi";
import { getLastProcessedBlock, setLastProcessedBlock } from "../db/chainState";
import { isTxCached, cacheTxResult } from "../db/paymentCache";
import { SupabaseConfig } from "../supabaseRest";

const CHAIN_STATE_KEY = "last_processed_block_usdt_transfers";
const CHUNK_SIZE = 2000;
const DEFAULT_LOOKBACK_BLOCKS = 300_000; // ~7 jours de blocs Polygon si aucun état précédent
const USDT_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const USDT_DECIMALS = 6;

export interface UsdtTransferEvent {
  from: string;
  amount: number; // en USDT humain (décimales déjà appliquées)
}

export async function catchUpUsdtTransfers(env: Env, db: SupabaseConfig): Promise<UsdtTransferEvent[]> {
  if (!env.PAYMENT_ADDRESS_USDT) return [];

  const rpc = { url: env.POLYGON_RPC_URL };
  const currentBlock = await getBlockNumber(rpc);
  const lastProcessed = await getLastProcessedBlock(db, CHAIN_STATE_KEY);
  let fromBlock = lastProcessed !== null ? lastProcessed + 1 : Math.max(0, currentBlock - DEFAULT_LOOKBACK_BLOCKS);

  if (fromBlock > currentBlock) {
    return [];
  }

  const toTopic = "0x" + encodeAddressArg(env.PAYMENT_ADDRESS_USDT);
  const events: UsdtTransferEvent[] = [];

  while (fromBlock <= currentBlock) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
    const logs = await getLogs(rpc, {
      address: USDT_TOKEN_ADDRESS,
      topics: [TRANSFER_TOPIC0, null, toTopic],
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      if (await isTxCached(db, log.transactionHash)) continue; // déjà traité (voir db/paymentCache.ts)

      const from = decodeAddressFromTopic(log.topics[1]);
      const amountRaw = decodeUint256(log.data);
      events.push({ from, amount: Number(amountRaw) / 10 ** USDT_DECIMALS });
      await cacheTxResult(db, log.transactionHash, true);
    }

    await setLastProcessedBlock(db, toBlock, CHAIN_STATE_KEY);
    fromBlock = toBlock + 1;
  }

  return events;
}
