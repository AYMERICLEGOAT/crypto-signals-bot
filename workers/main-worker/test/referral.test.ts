import { describe, it, expect } from "vitest";
import { encodeReferralCode, decodeReferralCode } from "../src/bot/referral";

describe("encodeReferralCode / decodeReferralCode", () => {
  it("fait un aller-retour correct pour un telegram_id typique", () => {
    const telegramId = 987654321;
    const code = encodeReferralCode(telegramId);
    expect(decodeReferralCode(code)).toBe(telegramId);
  });

  it("produit un code court (base36) plutôt que l'ID brut", () => {
    const code = encodeReferralCode(987654321);
    expect(code.length).toBeLessThan(String(987654321).length);
  });

  it("rejette un code invalide (non numérique en base36 ou négatif)", () => {
    expect(decodeReferralCode("!!!")).toBeNull();
    expect(decodeReferralCode("-5")).toBeNull();
    expect(decodeReferralCode("")).toBeNull();
  });

  it("fonctionne pour plusieurs IDs distincts sans collision triviale", () => {
    const ids = [1, 42, 123456, 999999999];
    const codes = ids.map(encodeReferralCode);
    expect(new Set(codes).size).toBe(ids.length);
    ids.forEach((id, i) => expect(decodeReferralCode(codes[i])).toBe(id));
  });
});
