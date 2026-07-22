/**
 * Validation d'adresse EVM avec checksum EIP-55, sans ethers.js.
 * Accepte : tout-minuscule, tout-majuscule, ou casse mixte respectant le
 * checksum (même comportement que `ethers.isAddress`) — rejette une casse
 * mixte qui ne respecte pas le checksum (télltale d'une adresse mal recopiée).
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";

export function isValidEthereumAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;

  const stripped = address.slice(2);
  if (stripped === stripped.toLowerCase() || stripped === stripped.toUpperCase()) {
    return true;
  }

  const hash = bytesToHex(keccak_256(new TextEncoder().encode(stripped.toLowerCase())));
  for (let i = 0; i < 40; i++) {
    const char = stripped[i];
    if (/[a-fA-F]/.test(char)) {
      const shouldBeUpper = parseInt(hash[i], 16) >= 8;
      if (shouldBeUpper && char !== char.toUpperCase()) return false;
      if (!shouldBeUpper && char !== char.toLowerCase()) return false;
    }
  }
  return true;
}
