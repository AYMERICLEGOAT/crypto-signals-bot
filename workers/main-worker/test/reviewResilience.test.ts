import { describe, it, expect, vi, afterEach } from "vitest";
import { handleReviewRating } from "../src/bot/commands/review";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

/**
 * Régression (01/08/2026, bug trouvé en test réel sur le Worker déployé) :
 * la contrainte CHECK de pending_actions n'acceptait pas
 * 'awaiting_review_comment'. L'insertion échouait en 23514, l'exception
 * remontait, et l'utilisateur recevait « Une erreur temporaire est survenue »
 * alors que sa note VENAIT D'ÊTRE enregistrée.
 */
describe("/review — la note prime sur le commentaire optionnel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("remercie quand même si l'attente de commentaire échoue, et enregistre la note", async () => {
    let ratingSaved = false;
    let sent = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/reviews") && init?.method === "POST") {
          ratingSaved = true;
          return jsonResponse([{ id: 7 }]);
        }
        if (url.includes("pending_actions")) {
          // Reproduit exactement l'erreur observée en production.
          return jsonResponse({ code: "23514", message: "violates check constraint" }, 400);
        }
        if (url.includes("api.telegram.org")) {
          sent = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleReviewRating(env, 42, "review:up");

    expect(ratingSaved).toBe(true);
    expect(sent).toContain("bien enregistrée");
    // Ne promet pas un commentaire qui serait impossible à enregistrer.
    expect(sent).not.toContain("répondre à ce message");
  });

  it("propose le commentaire quand tout fonctionne", async () => {
    let sent = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/reviews") && init?.method === "POST") return jsonResponse([{ id: 7 }]);
        if (url.includes("pending_actions")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sent = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleReviewRating(env, 42, "review:down");
    expect(sent).toContain("répondre à ce message");
  });

  it("ignore une donnée de callback invalide sans rien écrire", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await handleReviewRating(env, 42, "review:nimportequoi");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
