/**
 * Surveillance des transferts USDT (ERC20 `Transfer`) entrants vers l'adresse
 * de réception configurée (PAYMENT_ADDRESS_USDT) — remplace l'écoute de
 * l'événement `Subscribed` du smart contract pour le flux 100% off-chain
 * (V2). Même principe de rattrapage par checkpoint que subscriptionEvents.ts,
 * avec sa propre clé dans `chain_state` pour ne pas interférer avec elle.
 */

import { Env } from "../env";
import { getBlockNumber, getLogs, buildPolygonRpcConfig } from "./rpc";
import { TRANSFER_TOPIC0, decodeAddressFromTopic, decodeUint256, encodeAddressArg } from "./abi";
import { getLastProcessedBlock, setLastProcessedBlock } from "../db/chainState";
import { isTxCached, cacheTxResult } from "../db/paymentCache";
import { SupabaseConfig } from "../supabaseRest";

const CHAIN_STATE_KEY = "last_processed_block_usdt_transfers";
const CHUNK_SIZE = 2000;

/**
 * Tranches traitees par passage du cron. Voir la boucle plus bas : sans cette
 * borne, un rattrapage de 40 000 blocs epuisait a lui seul le budget de
 * sous-requetes de l'invocation et tuait les taches suivantes de la chaine.
 */
export const MAX_CHUNKS_PER_RUN = 4;
/**
 * Profondeur du PREMIER scan, quand aucune position n'est encore enregistrée.
 *
 * ELLE VALAIT 300 000 BLOCS, ET C'EST CE QUI A EMPÊCHÉ TOUT PAIEMENT USDT
 * D'ÊTRE DÉTECTÉ. Les nœuds Polygon publics élaguent leur historique : mesuré
 * le 10/08/2026 sur polygon-bor-rpc.publicnode.com, `eth_getLogs` répond à
 * −500, −2 000, −10 000 et −50 000 blocs, et échoue à −300 000 avec
 * « History has been pruned for this block ».
 *
 * L'enchaînement était donc fatal : premier scan à −300 000 → erreur →
 * setLastProcessedBlock jamais atteint → aucune position enregistrée → le
 * cycle suivant repart du même bloc introuvable. Boucle infinie, silencieuse,
 * sur le moyen de paiement que /subscribe RECOMMANDE.
 *
 * 40 000 blocs ≈ 22 h sur Polygon (~2 s par bloc). C'est assez pour rattraper
 * un paiement fait juste avant la mise en service, et très en dessous de la
 * limite d'élagage mesurée.
 */
const DEFAULT_LOOKBACK_BLOCKS = 40_000;
const USDT_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const USDT_DECIMALS = 6;

export interface UsdtTransferEvent {
  from: string;
  amount: number; // en USDT humain (décimales déjà appliquées)
}

export async function catchUpUsdtTransfers(env: Env, db: SupabaseConfig): Promise<UsdtTransferEvent[]> {
  if (!env.PAYMENT_ADDRESS_USDT) return [];

  const rpc = buildPolygonRpcConfig(env);
  const currentBlock = await getBlockNumber(rpc);
  const lastProcessed = await getLastProcessedBlock(db, CHAIN_STATE_KEY);
  let fromBlock = lastProcessed !== null ? lastProcessed + 1 : Math.max(0, currentBlock - DEFAULT_LOOKBACK_BLOCKS);

  if (fromBlock > currentBlock) {
    return [];
  }

  const toTopic = "0x" + encodeAddressArg(env.PAYMENT_ADDRESS_USDT);
  const events: UsdtTransferEvent[] = [];

  // LE RATTRAPAGE EST BORNÉ PAR PASSAGE, et il doit l'être.
  //
  // Rendre ce scan fonctionnel l'a rendu coûteux : 40 000 blocs découpés en
  // tranches de 2 000 font vingt appels eth_getLogs, plus autant d'écritures de
  // position, dans une SEULE invocation. Un Worker Cloudflare est plafonné à
  // 50 sous-requêtes par invocation — la chaîne des cinq minutes a donc saturé
  // dès le premier cycle, et les deux dernières tâches (surveillance du
  // heartbeat et fraîcheur des signaux) sont mortes avec elle.
  //
  // Quatre tranches par passage, soit 8 000 blocs. Le cron tourne toutes les
  // cinq minutes : un retard de 40 000 blocs se rattrape en cinq cycles, et
  // chaque tranche traitée est enregistrée immédiatement — rien n'est refait.
  //
  // En régime établi, Polygon produit environ 150 blocs en cinq minutes : une
  // seule tranche suffit largement, et la borne ne se voit jamais.
  let tranches = 0;

  while (fromBlock <= currentBlock && tranches < MAX_CHUNKS_PER_RUN) {
    tranches++;
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);

    // DEUX NATURES D'ÉCHEC, DEUX RÉPONSES OPPOSÉES — et les confondre coûte
    // soit de l'argent, soit le service entier.
    //
    // « History has been pruned » signifie que le nœud public a JETÉ ces
    // blocs : aucune reprise ne les ramènera jamais. Réessayer éternellement
    // bloque le scan à cette position pour toujours, ce qui est exactement ce
    // qui s'est produit — la position n'était jamais enregistrée, donc chaque
    // cycle repartait du même bloc introuvable et échouait de la même façon.
    // Face à ça, la seule issue est d'avancer.
    //
    // Toute AUTRE erreur (réseau, limite de débit, nœud momentanément absent)
    // est transitoire. Avancer y serait dangereux : on sauterait des blocs qui
    // contiennent peut-être un paiement réel, et l'abonné aurait payé sans
    // jamais être activé. On relance donc, et le cycle suivant réessaiera.
    let logs;
    try {
      logs = await getLogs(rpc, {
        address: USDT_TOKEN_ADDRESS,
        topics: [TRANSFER_TOPIC0, null, toTopic],
        fromBlock,
        toBlock,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/pruned|not available|missing trie node/i.test(message)) throw err;

      console.warn(
        `[usdt-offchain] Blocs ${fromBlock}-${toBlock} élagués par le nœud : ils sont définitivement ` +
          "hors de portée, on avance plutôt que de bloquer le scan à cette position."
      );
      await setLastProcessedBlock(db, toBlock, CHAIN_STATE_KEY);
      fromBlock = toBlock + 1;
      continue;
    }

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
