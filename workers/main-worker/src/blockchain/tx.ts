/**
 * Construction + signature d'une transaction Ethereum "legacy" (type 0,
 * EIP-155), sans ethers.js. Recette validée empiriquement sous workerd
 * (vitest-pool-workers) ET recoupée avec ethers.js en Node : la transaction
 * signée ici est décodée par `ethers.Transaction.from()` avec exactement les
 * mêmes champs, et l'adresse récupérée depuis la signature correspond à
 * celle dérivée indépendamment de la clé privée.
 */

import { RLP } from "@ethereumjs/rlp";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import { JsonRpcConfig, getTransactionCount, getGasPrice, getChainId } from "./rpc";

const DEFAULT_GAS_LIMIT = 150_000n;

function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function numToMinimalBytes(n: bigint): Uint8Array {
  if (n === 0n) return new Uint8Array(0);
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return hexToBytes(hex);
}

export function privateKeyToAddress(privateKeyHex: string): string {
  const privKey = hexToBytes(stripHexPrefix(privateKeyHex));
  const pubKey = secp256k1.getPublicKey(privKey, false).slice(1); // enlève le préfixe 0x04 (non compressé)
  const hash = keccak_256(pubKey);
  return "0x" + bytesToHex(hash.slice(-20));
}

export interface TxParams {
  to: string;
  data: string; // hex, avec ou sans préfixe 0x
  value: bigint;
  gasLimit?: bigint;
}

/** Construit, signe (EIP-155) et RLP-encode une transaction. Retourne le raw tx hex, prêt pour eth_sendRawTransaction. */
export async function buildAndSignLegacyTx(rpc: JsonRpcConfig, privateKeyHex: string, params: TxParams): Promise<string> {
  const privKey = hexToBytes(stripHexPrefix(privateKeyHex));
  const fromAddress = privateKeyToAddress(privateKeyHex);

  const [nonce, gasPrice, chainId] = await Promise.all([
    getTransactionCount(rpc, fromAddress),
    getGasPrice(rpc),
    getChainId(rpc),
  ]);

  const to = hexToBytes(stripHexPrefix(params.to));
  const data = hexToBytes(stripHexPrefix(params.data));
  const gasLimit = params.gasLimit ?? DEFAULT_GAS_LIMIT;

  const unsignedFields = [
    numToMinimalBytes(BigInt(nonce)),
    numToMinimalBytes(gasPrice),
    numToMinimalBytes(gasLimit),
    to,
    numToMinimalBytes(params.value),
    data,
    numToMinimalBytes(chainId),
    new Uint8Array(0),
    new Uint8Array(0),
  ];
  const msgHash = keccak_256(RLP.encode(unsignedFields));
  const sig = secp256k1.sign(msgHash, privKey);
  const v = BigInt(sig.recovery!) + chainId * 2n + 35n; // EIP-155

  const signedFields = [
    numToMinimalBytes(BigInt(nonce)),
    numToMinimalBytes(gasPrice),
    numToMinimalBytes(gasLimit),
    to,
    numToMinimalBytes(params.value),
    data,
    numToMinimalBytes(v),
    numToMinimalBytes(sig.r),
    numToMinimalBytes(sig.s),
  ];
  return "0x" + bytesToHex(RLP.encode(signedFields));
}
