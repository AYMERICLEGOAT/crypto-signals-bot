/**
 * Rattrapage des événements `Subscribed` (paiements USDT confirmés on-chain).
 * Remplace le `contract.on()` en écoute continue du bot Node (module 2),
 * incompatible avec le modèle Workers (pas de process persistant) : ici, un
 * Cron Trigger appelle catchUpMissedEvents() toutes les 5 minutes, qui
 * reprend exactement où le rattrapage précédent s'est arrêté (voir
 * db/chainState.ts, qui remplace data/last_block.json).
 */

import { Env } from "../env";
import { getBlockNumber, getLogs } from "./rpc";
import { SUBSCRIBED_TOPIC0, decodeAddressFromTopic, decodeSubscribedData } from "./abi";
import { getLastProcessedBlock, setLastProcessedBlock } from "../db/chainState";
import { isTxCached, cacheTxResult } from "../db/paymentCache";
import { SupabaseConfig } from "../supabaseRest";

const CHUNK_SIZE = 2000; // limite prudente pour eth_getLogs sur un RPC public gratuit
const DEFAULT_LOOKBACK_BLOCKS = 300_000; // ~7 jours de blocs Polygon si aucun état précédent

export interface SubscribedEvent {
  user: string;
  plan: number;
  amount: bigint;
  newExpirationMs: number;
}

export async function catchUpMissedEvents(env: Env, db: SupabaseConfig): Promise<SubscribedEvent[]> {
  const rpc = { url: env.POLYGON_RPC_URL };
  const currentBlock = await getBlockNumber(rpc);
  const lastProcessed = await getLastProcessedBlock(db);
  let fromBlock = lastProcessed !== null ? lastProcessed + 1 : Math.max(0, currentBlock - DEFAULT_LOOKBACK_BLOCKS);

  if (fromBlock > currentBlock) return [];

  const events: SubscribedEvent[] = [];
  while (fromBlock <= currentBlock) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
    const logs = await getLogs(rpc, {
      address: env.CONTRACT_ADDRESS,
      topics: [SUBSCRIBED_TOPIC0],
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      if (await isTxCached(db, log.transactionHash)) continue; // déjà traité (voir db/paymentCache.ts)

      const { plan, amount, newExpiration } = decodeSubscribedData(log.data);
      events.push({
        user: decodeAddressFromTopic(log.topics[1]),
        plan,
        amount,
        newExpirationMs: Number(newExpiration) * 1000,
      });
      await cacheTxResult(db, log.transactionHash, true);
    }

    await setLastProcessedBlock(db, toBlock);
    fromBlock = toBlock + 1;
  }

  return events;
}
