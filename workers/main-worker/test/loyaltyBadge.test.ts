import { describe, it, expect } from "vitest";
import { getLoyaltyBadge } from "../src/bot/loyaltyBadge";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe("getLoyaltyBadge", () => {
  it("retourne null si l'utilisateur n'a jamais payé (plan_started_at null)", () => {
    expect(getLoyaltyBadge({ plan_started_at: null })).toBeNull();
  });

  it("retourne null avant 3 mois d'ancienneté", () => {
    expect(getLoyaltyBadge({ plan_started_at: daysAgoIso(60) })).toBeNull();
  });

  it("retourne 'Trader confirmé' entre 3 et 6 mois", () => {
    expect(getLoyaltyBadge({ plan_started_at: daysAgoIso(100) })).toContain("Trader confirmé");
  });

  it("retourne 'Vétéran' après 6 mois", () => {
    expect(getLoyaltyBadge({ plan_started_at: daysAgoIso(200) })).toContain("Vétéran");
  });
});
