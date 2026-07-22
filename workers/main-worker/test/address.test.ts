import { describe, it, expect } from "vitest";
import { isValidEthereumAddress } from "../src/utils/address";

describe("isValidEthereumAddress", () => {
  // Référence croisée avec ethers.isAddress() en Node (voir conversation) :
  // bon checksum -> true, casse mixte invalide -> false, tout minuscule/majuscule -> true.
  const GOOD_CHECKSUM = "0x71367B5f4519700a63c2564b754cF959317E1f61";
  const BAD_MIXED_CASE = "0x71367b5f4519700a63c2564b754cF959317E1f61";

  it("accepte une adresse avec un checksum EIP-55 correct", () => {
    expect(isValidEthereumAddress(GOOD_CHECKSUM)).toBe(true);
  });

  it("rejette une adresse à casse mixte avec un checksum incorrect", () => {
    expect(isValidEthereumAddress(BAD_MIXED_CASE)).toBe(false);
  });

  it("accepte une adresse tout en minuscules", () => {
    expect(isValidEthereumAddress(GOOD_CHECKSUM.toLowerCase())).toBe(true);
  });

  it("accepte une adresse tout en majuscules (partie hex)", () => {
    expect(isValidEthereumAddress("0x" + GOOD_CHECKSUM.slice(2).toUpperCase())).toBe(true);
  });

  it("rejette un format invalide", () => {
    expect(isValidEthereumAddress("pas une adresse")).toBe(false);
    expect(isValidEthereumAddress("0x123")).toBe(false);
    expect(isValidEthereumAddress(GOOD_CHECKSUM + "a")).toBe(false);
  });
});
