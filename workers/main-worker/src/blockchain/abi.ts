/**
 * Encodage/décodage ABI "à la main", limité aux quelques fonctions et à
 * l'événement dont on a besoin (pas de lib ABI générique : inutile ici,
 * et ça évite une dépendance de plus à valider sous workerd).
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";

function selector(signature: string): string {
  const hash = keccak_256(new TextEncoder().encode(signature));
  return "0x" + bytesToHex(hash.slice(0, 4));
}

export const SELECTORS = {
  isActive: selector("isActive(address)"),
  plan1Price: selector("PLAN1_PRICE()"),
  plan2Price: selector("PLAN2_PRICE()"),
  setTrial: selector("setTrial(address)"),
};

export const SUBSCRIBED_TOPIC0 =
  "0x" + bytesToHex(keccak_256(new TextEncoder().encode("Subscribed(address,uint8,uint256,uint256)")));

// Événement standard ERC20 Transfer(address indexed from, address indexed to, uint256 value).
// Vérifié contre la valeur bien connue 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef.
export const TRANSFER_TOPIC0 =
  "0x" + bytesToHex(keccak_256(new TextEncoder().encode("Transfer(address,address,uint256)")));

function stripHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function padLeft32(hex: string): string {
  return hex.padStart(64, "0");
}

export function encodeAddressArg(address: string): string {
  return padLeft32(stripHexPrefix(address).toLowerCase());
}

export function encodeCall(selectorHex: string, ...argsHex: string[]): string {
  return selectorHex + argsHex.join("");
}

export function decodeUint256(resultHex: string): bigint {
  return BigInt(resultHex === "0x" ? "0x0" : resultHex);
}

export function decodeBool(resultHex: string): boolean {
  return decodeUint256(resultHex) !== 0n;
}

export function decodeAddressFromTopic(topicHex: string): string {
  return "0x" + stripHexPrefix(topicHex).slice(-40);
}

/** Décode les 3 champs non indexés (plan, amount, newExpiration) du champ `data` de l'événement Subscribed. */
export function decodeSubscribedData(dataHex: string): { plan: number; amount: bigint; newExpiration: bigint } {
  const hex = stripHexPrefix(dataHex);
  const plan = Number(BigInt("0x" + hex.slice(0, 64)));
  const amount = BigInt("0x" + hex.slice(64, 128));
  const newExpiration = BigInt("0x" + hex.slice(128, 192));
  return { plan, amount, newExpiration };
}
