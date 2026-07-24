import { describe, it, expect, vi, afterEach } from "vitest";
import { sendSatisfactionSurveys } from "../src/cron/satisfactionSurvey";
import { handleSurveyResponse } from "../src/bot/commands/surveyResponse";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = { TELEGRAM_BOT_TOKEN: "fake-token", SUPABASE_URL: "https://fake-supabase.test", SUPABASE_KEY: "k" } as any;

describe("sendSatisfactionSurveys", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("envoie le sondage aux abonnés payants depuis 7+ jours et marque l'envoi", async () => {
    let keyboardSent: unknown = null;
    let marked = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("survey_sent=eq.false") && (!init || init.method === undefined)) {
          return jsonResponse([{ telegram_id: 7, plan_started_at: "2020-01-01T00:00:00Z", survey_sent: false }]);
        }
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          keyboardSent = body.reply_markup;
          return jsonResponse({ ok: true, result: {} });
        }
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          if (body.survey_sent === true) marked = true;
          return jsonResponse([]);
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await sendSatisfactionSurveys(env);
    expect(marked).toBe(true);
    expect(keyboardSent).toBeTruthy();
  });

  it("ne fait rien si personne n'est éligible", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([])));
    await sendSatisfactionSurveys(env);
  });
});

describe("handleSurveyResponse", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enregistre la réponse 👍 et remercie", async () => {
    let storedResponse: string | null = null;
    let thanked = "";

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && init?.method === "PATCH") {
          const body = JSON.parse(init.body as string);
          storedResponse = body.survey_response;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) {
          thanked = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleSurveyResponse(env, 7, "survey:up");
    expect(storedResponse).toBe("up");
    expect(thanked).toContain("Merci");
  });

  it("enregistre la réponse 👎", async () => {
    let storedResponse: string | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("users") && init?.method === "PATCH") {
          storedResponse = JSON.parse(init.body as string).survey_response;
          return jsonResponse([]);
        }
        if (url.includes("api.telegram.org")) return jsonResponse({ ok: true, result: {} });
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleSurveyResponse(env, 7, "survey:down");
    expect(storedResponse).toBe("down");
  });
});
