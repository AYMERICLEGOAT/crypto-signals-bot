import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { contract, provider } from "./contract";

const LAST_BLOCK_FILE = path.join(__dirname, "..", "..", "data", "last_block.json");
const CHUNK_SIZE = 2000; // limite prudente pour eth_getLogs sur un RPC public gratuit
// Si aucun état précédent n'existe, on ne remonte pas plus loin que ~7 jours de
// blocs (Polygon ~2s/bloc) pour éviter un premier scan interminable.
const DEFAULT_LOOKBACK_BLOCKS = 300_000;

export interface SubscribedPayload {
  user: string;
  plan: number;
  amount: bigint;
  newExpirationMs: number;
}

export type SubscribedHandler = (payload: SubscribedPayload) => Promise<void>;

function readLastProcessedBlock(): number | null {
  try {
    const raw = fs.readFileSync(LAST_BLOCK_FILE, "utf-8");
    return JSON.parse(raw).lastBlock;
  } catch {
    return null;
  }
}

function writeLastProcessedBlock(blockNumber: number): void {
  fs.mkdirSync(path.dirname(LAST_BLOCK_FILE), { recursive: true });
  fs.writeFileSync(LAST_BLOCK_FILE, JSON.stringify({ lastBlock: blockNumber }, null, 2));
}

async function handleEventLog(log: ethers.EventLog, handler: SubscribedHandler): Promise<void> {
  const [user, plan, amount, newExpiration] = log.args as unknown as [string, bigint, bigint, bigint];
  await handler({
    user,
    plan: Number(plan),
    amount,
    newExpirationMs: Number(newExpiration) * 1000,
  });
  writeLastProcessedBlock(log.blockNumber);
}

/**
 * Rattrape les événements `Subscribed` manqués pendant que le bot était arrêté
 * (PC éteint, redémarrage...). Reprend exactement au bloc suivant le dernier
 * traité — aucune perte, aucun doublon.
 */
export async function catchUpMissedEvents(handler: SubscribedHandler): Promise<void> {
  const currentBlock = await provider.getBlockNumber();
  const lastProcessed = readLastProcessedBlock();
  let fromBlock = lastProcessed !== null ? lastProcessed + 1 : Math.max(0, currentBlock - DEFAULT_LOOKBACK_BLOCKS);

  if (fromBlock > currentBlock) {
    writeLastProcessedBlock(currentBlock);
    return;
  }

  const filter = contract.filters.Subscribed();
  while (fromBlock <= currentBlock) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
    const logs = (await contract.queryFilter(filter, fromBlock, toBlock)) as ethers.EventLog[];
    for (const log of logs) {
      await handleEventLog(log, handler);
    }
    writeLastProcessedBlock(toBlock);
    fromBlock = toBlock + 1;
  }
}

/** Écoute les nouveaux événements `Subscribed` en direct (polling du RPC en interne). */
export function listenForNewSubscriptions(handler: SubscribedHandler): void {
  contract.on(contract.filters.Subscribed(), async (...eventArgs: unknown[]) => {
    const payload = eventArgs[eventArgs.length - 1] as { log: ethers.EventLog };
    await handleEventLog(payload.log, handler);
  });
}
