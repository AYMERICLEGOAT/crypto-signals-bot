import { describe, it, expect, vi, afterEach } from "vitest";
import { hasWalletClaimedTrial } from "../src/db/users";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("hasWalletClaimedTrial — anti-abus de l'essai gratuit sans contrat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renvoie true si un utilisateur (n'importe lequel) a déjà consommé un essai avec cette adresse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("wallet_address=eq.0xabc");
        expect(url).toContain("trial_used=eq.true");
        return jsonResponse([{ telegram_id: 999, wallet_address: "0xabc", trial_used: true }]);
      })
    );

    const result = await hasWalletClaimedTrial({ url: "https://fake-supabase.test", key: "k" }, "0xABC");
    expect(result).toBe(true);
  });

  it("renvoie false si aucun essai n'a jamais été consommé avec cette adresse", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));

    const result = await hasWalletClaimedTrial({ url: "https://fake-supabase.test", key: "k" }, "0xdef");
    expect(result).toBe(false);
  });
});
