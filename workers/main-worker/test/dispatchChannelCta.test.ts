import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchChannelCta } from "../src/cron/dispatchChannelCta";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  TELEGRAM_CHANNEL_ID: "-100123456",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

describe("dispatchChannelCta (refonte UX du 01/08/2026, cron toutes les 3h)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("poste le rappel dans le canal public avec le nom d'utilisateur du bot", async () => {
    let posted: { chatId: number; text: string } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          const body = JSON.parse(init!.body as string);
          posted = { chatId: body.chat_id, text: body.text };
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await dispatchChannelCta(env);

    expect(posted).not.toBeNull();
    expect(posted!.chatId).toBe(-100123456);
    expect(posted!.text).toContain("@ProVIPSignals_bot");
    expect(posted!.text).toContain("temps réel");
    expect(posted!.text).toContain("sécurisation automatique");
  });

  it("ne fait rien si le canal public n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchChannelCta({ ...env, TELEGRAM_CHANNEL_ID: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ne fait rien si le nom d'utilisateur du bot n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await dispatchChannelCta({ ...env, TELEGRAM_BOT_USERNAME: undefined });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
