import { describe, it, expect } from "vitest";
import { privateKeyToAddress } from "../src/blockchain/tx";

// Paire clé privée / adresse générée avec ethers (Node, hors workerd) comme
// référence indépendante (voir conversation) — vérifie que notre dérivation
// d'adresse "à la main" (keccak256 de la clé publique non compressée) donne
// le même résultat que la lib de référence de l'écosystème.
const REF_PRIVATE_KEY = "0x9d92b00f863ccfe095160dc2df15ddb17f96101f8805902b4620da7790e3039d";
const REF_ADDRESS = "0x01596642D9394C2127c358E58a0b37c8D8373757";

describe("privateKeyToAddress", () => {
  it("dérive la même adresse qu'ethers.js à partir de la même clé privée", () => {
    expect(privateKeyToAddress(REF_PRIVATE_KEY).toLowerCase()).toBe(REF_ADDRESS.toLowerCase());
  });

  it("fonctionne aussi sans le préfixe 0x", () => {
    expect(privateKeyToAddress(REF_PRIVATE_KEY.slice(2)).toLowerCase()).toBe(REF_ADDRESS.toLowerCase());
  });
});
