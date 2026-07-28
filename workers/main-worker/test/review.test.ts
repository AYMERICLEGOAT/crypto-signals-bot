import { describe, it, expect, vi, afterEach } from "vitest";
import { handleReviewCommand, handleReviewRating, handleReviewComment } from "../src/bot/commands/review";
import { handleTextMessage } from "../src/bot/walletAddressHandler";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("handleReviewCommand (Étape 3, preuve sociale)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("propose les boutons 👍/👎", async () => {
    let keyboard: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          keyboard = JSON.parse(init!.body as string).reply_markup.inline_keyboard;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleReviewCommand(env, 111);
    const labels = keyboard[0].map((b: any) => b.text);
    expect(labels).toEqual(["👍 J'aime", "👎 Je n'aime pas"]);
    expect(keyboard[0][0].callback_data).toBe("review:up");
    expect(keyboard[0][1].callback_data).toBe("review:down");
  });
});

describe("handleReviewRating", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enregistre la note, arme l'attente d'un commentaire, et confirme", async () => {
    let insertedReview: any;
    let pendingAction: any;
    let confirmText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/reviews") && init?.method === "POST") {
          insertedReview = JSON.parse(init.body as string);
          return jsonResponse([{ id: 42, ...insertedReview }]);
        }
        if (url.includes("pending_actions") && init?.method === "POST") {
          pendingAction = JSON.parse(init.body as string);
          return jsonResponse([pendingAction]);
        }
        if (url.includes("api.telegram.org")) {
          confirmText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleReviewRating(env, 111, "review:up");
    expect(insertedReview.rating).toBe("up");
    expect(insertedReview.telegram_id).toBe(111);
    expect(pendingAction.action_type).toBe("awaiting_review_comment");
    expect(pendingAction.review_id).toBe(42);
    expect(confirmText).toContain("Merci pour ta note");
  });

  it("ignore un callback_data qui ne correspond à aucune note valide", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await handleReviewRating(env, 111, "review:invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleReviewComment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("attache le commentaire à la review existante (tronqué à 500 caractères) et confirme", async () => {
    let patched: any;
    let patchedUrl = "";
    let confirmText = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("/reviews") && init?.method === "PATCH") {
          patchedUrl = url;
          patched = JSON.parse(init.body as string);
          return jsonResponse([{ id: 42, comment: patched.comment }]);
        }
        if (url.includes("api.telegram.org")) {
          confirmText = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleReviewComment(env, 111, 42, "Super bot, merci !");
    expect(patchedUrl).toContain("id=eq.42");
    expect(patched.comment).toBe("Super bot, merci !");
    expect(confirmText).toContain("Merci");
  });
});

describe("handleTextMessage — intégration du commentaire de review (walletAddressHandler)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("route un message texte libre vers le commentaire de review quand c'est ce qui est attendu", async () => {
    let deletedPending = false;
    let patchedComment: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("pending_actions") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 111, action_type: "awaiting_review_comment", plan: null, review_id: 42 }]);
        }
        if (url.includes("pending_actions") && init?.method === "DELETE") {
          deletedPending = true;
          return jsonResponse([]);
        }
        if (url.includes("/reviews") && init?.method === "PATCH") {
          patchedComment = JSON.parse(init.body as string).comment;
          return jsonResponse([{ id: 42, comment: patchedComment }]);
        }
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleTextMessage(env, 111, "Très bon bot, continuez comme ça");
    expect(deletedPending).toBe(true);
    expect(patchedComment).toBe("Très bon bot, continuez comme ça");
  });
});
