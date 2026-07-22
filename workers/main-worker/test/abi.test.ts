import { describe, it, expect } from "vitest";
import {
  SELECTORS,
  SUBSCRIBED_TOPIC0,
  encodeAddressArg,
  encodeCall,
  decodeUint256,
  decodeBool,
  decodeAddressFromTopic,
  decodeSubscribedData,
} from "../src/blockchain/abi";

// Valeurs de référence calculées indépendamment avec `ethers.id(...)` en Node
// (voir conversation) — sert à vérifier que notre keccak256 "à la main" donne
// bien les mêmes sélecteurs/topic que la lib de référence de l'écosystème.
const REF = {
  isActive: "0x9f8a13d7",
  plan1Price: "0xfe3175cb",
  plan2Price: "0x8a672de2",
  setTrial: "0x4914c997",
  subscribedTopic0: "0x0461beb329d7acfbed27b25e75051d4b137810d66ecd6d048744f7b636385ad0",
};

describe("abi.ts — sélecteurs et topic, recoupés avec ethers.id()", () => {
  it("calcule les bons sélecteurs de fonction", () => {
    expect(SELECTORS.isActive).toBe(REF.isActive);
    expect(SELECTORS.plan1Price).toBe(REF.plan1Price);
    expect(SELECTORS.plan2Price).toBe(REF.plan2Price);
    expect(SELECTORS.setTrial).toBe(REF.setTrial);
  });

  it("calcule le bon topic0 pour l'événement Subscribed", () => {
    expect(SUBSCRIBED_TOPIC0).toBe(REF.subscribedTopic0);
  });
});

describe("abi.ts — encodage/décodage", () => {
  it("encode un argument address, aligné sur 32 octets", () => {
    const encoded = encodeAddressArg("0x71367B5f4519700a63c2564b754cF959317E1f61");
    expect(encoded).toBe("71367b5f4519700a63c2564b754cf959317e1f61".padStart(64, "0"));
    expect(encoded.length).toBe(64);
  });

  it("concatène sélecteur + arguments pour former le calldata", () => {
    const data = encodeCall(SELECTORS.isActive, encodeAddressArg("0x71367B5f4519700a63c2564b754cF959317E1f61"));
    expect(data.startsWith(SELECTORS.isActive)).toBe(true);
    expect(data.length).toBe(10 + 64); // "0x" + 8 hex (sélecteur) + 64 hex (argument)
  });

  it("décode un uint256 et un bool depuis un résultat eth_call", () => {
    expect(decodeUint256("0x" + (10n).toString(16).padStart(64, "0"))).toBe(10n);
    expect(decodeBool("0x" + (1n).toString(16).padStart(64, "0"))).toBe(true);
    expect(decodeBool("0x" + (0n).toString(16).padStart(64, "0"))).toBe(false);
  });

  it("décode une adresse depuis un topic indexé (padded 32 octets)", () => {
    const address = "71367b5f4519700a63c2564b754cf959317e1f61";
    const topic = "0x" + address.padStart(64, "0");
    expect(decodeAddressFromTopic(topic).toLowerCase()).toBe("0x" + address);
  });

  it("décode les champs non indexés de l'événement Subscribed (plan, amount, newExpiration)", () => {
    const plan = 2n;
    const amount = 25_000_000n; // 25 USDT, 6 décimales
    const newExpiration = 1_800_000_000n;
    const data =
      "0x" +
      plan.toString(16).padStart(64, "0") +
      amount.toString(16).padStart(64, "0") +
      newExpiration.toString(16).padStart(64, "0");

    const decoded = decodeSubscribedData(data);
    expect(decoded.plan).toBe(2);
    expect(decoded.amount).toBe(amount);
    expect(decoded.newExpiration).toBe(newExpiration);
  });
});
