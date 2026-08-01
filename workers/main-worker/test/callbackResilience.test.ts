import { describe, it, expect, vi, afterEach } from "vitest";
import { routeUpdate } from "../src/bot/router";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  ADMIN_TELEGRAM_ID: "999",
} as any;

/**
 * Régression (01/08/2026) : answerCallbackQuery n'est qu'un accusé de
 * réception visuel (le sablier sur le bouton). Telegram le refuse avec un
 * 400 "query is too old" dès que la callback query a expiré — cas réel quand
 * l'utilisateur clique sur un bouton d'un message ancien, ou quand le Worker
 * démarre à froid. L'exception faisait alors abandonner toute la suite :
 * l'utilisateur cliquait « S'abonner » et il ne se passait rien.
 */
describe("Résilience des boutons — un accusé de réception refusé ne doit rien bloquer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("exécute quand même l'action quand answerCallbackQuery échoue en 400", async () => {
    let statusRequested = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("answerCallbackQuery")) {
          return new Response(
            JSON.stringify({ ok: false, error_code: 400, description: "Bad Request: query is too old" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
          );
        }
        // La commande /status déclenchée par le bouton lit l'utilisateur.
        if (url.includes("/users")) {
          statusRequested = true;
          return jsonResponse([
            { telegram_id: 42, plan: 1, expiration: "2099-01-01T00:00:00.000Z", trial_used: false, created_at: "2026-01-01T00:00:00Z" },
          ]);
        }
        // Le limiteur autorise : sans ceci, isRateLimited() traite une reponse
        // vide comme un blocage et le callback sort avant toute action.
        if (url.includes("consume_command_rate_limit") || url.includes("/rpc/")) return jsonResponse([{ allowed: true }]);
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        return jsonResponse([]);
      })
    );

    await routeUpdate(env, {
      update_id: 1,
      callback_query: {
        id: "trop-vieux",
        data: "start:status",
        from: { id: 42 },
        message: { message_id: 7, chat: { id: 42 } },
      },
    } as any);

    expect(statusRequested).toBe(true);
  });

  it("ne remonte aucune exception à l'appelant dans ce cas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("answerCallbackQuery")) {
          return new Response("query is too old", { status: 400 });
        }
        if (url.includes("consume_command_rate_limit") || url.includes("/rpc/")) return jsonResponse([{ allowed: true }]);
        if (url.includes("/users")) {
          return jsonResponse([{ telegram_id: 42, plan: null, expiration: null, trial_used: false, created_at: "2026-01-01T00:00:00Z" }]);
        }
        return jsonResponse([]);
      })
    );

    await expect(
      routeUpdate(env, {
        update_id: 2,
        callback_query: { id: "x", data: "start:status", from: { id: 42 }, message: { message_id: 1, chat: { id: 42 } } },
      } as any)
    ).resolves.not.toThrow();
  });
});
