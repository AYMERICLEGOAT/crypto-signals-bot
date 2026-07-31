import { describe, it, expect, vi, afterEach } from "vitest";
import { hasWalletClaimedTrial } from "../src/db/users";
import { activateTrialForWallet, handleTrialCommand } from "../src/bot/commands/trial";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;
const db = { url: env.SUPABASE_URL, key: env.SUPABASE_KEY };

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

describe("activateTrialForWallet — bug corrigé (31/07) : le wallet n'était jamais enregistré", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enregistre bien wallet_address en base lors de l'activation (sinon hasWalletClaimedTrial ne peut jamais matcher au tour suivant)", async () => {
    let patchedWallet: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("wallet_address=eq.") && url.includes("trial_used=eq.true")) return jsonResponse([]); // wallet neuf
        if (url.includes("/users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.wallet_address) patchedWallet = body.wallet_address;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await activateTrialForWallet(env, 111, "0xNEWWALLET");
    expect(patchedWallet).toBe("0xnewwallet"); // setWalletAddress normalise en minuscules
  });

  it("bloque un deuxième compte Telegram qui réutilise un wallet déjà enregistré par un essai précédent (scénario d'exploitation réel)", async () => {
    let secondAttemptActivated = false;
    // Simule l'état APRÈS un premier essai réussi : le wallet est maintenant connu en base.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("wallet_address=eq.") && url.includes("trial_used=eq.true")) {
          return jsonResponse([{ telegram_id: 111, wallet_address: "0xshared", trial_used: true }]);
        }
        if (url.includes("/users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.expiration) secondAttemptActivated = true; // activateSubscription ne doit JAMAIS être atteint
          return jsonResponse([]);
        }
        // Wallet déjà réclamé -> setPendingAction() réinvite à saisir une autre adresse (upsert sur pending_actions).
        if (url.includes("pending_actions")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await activateTrialForWallet(env, 222, "0xSHARED"); // deuxième compte Telegram, même wallet
    expect(secondAttemptActivated).toBe(false);
  });
});

describe("handleTrialCommand — ne doit jamais écraser un abonnement payant actif", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuse l'essai si l'utilisateur a déjà un plan payant actif, sans toucher à son expiration", async () => {
    let expirationTouched = false;
    let refusalText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/users") && url.includes("telegram_id=eq.") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 333, plan: 1, trial_used: false, expiration: "2099-01-01T00:00:00.000Z", wallet_address: "0xabc" }]);
        }
        if (url.includes("/users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.expiration) expirationTouched = true;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          refusalText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleTrialCommand(env, 333);
    expect(expirationTouched).toBe(false);
    expect(refusalText).toContain("déjà un abonnement payant actif");
  });
});
