import { describe, it, expect, vi, afterEach } from "vitest";
import { handleGuideCommand } from "../src/bot/commands/guide";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
} as any;

function stub(signalRecent: unknown[] = []) {
  const messages: { text: string; keyboard?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        const b = JSON.parse(init!.body as string);
        messages.push({ text: b.text, keyboard: b.reply_markup });
        return jsonResponse({ ok: true, result: {} });
      }
      return jsonResponse(signalRecent);
    })
  );
  return messages;
}

describe("/guide", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne dit JAMAIS de placer un take profit pour sécuriser le gain", async () => {
    // C'est l'instruction qui figurait à l'étape 5 et qui contredisait toute
    // la stratégie : la sortie est temporelle, et couper au jalon conserve
    // les perdants en se privant des seuls gagnants qui paient.
    const messages = stub();
    await handleGuideCommand(env, 1);
    const texte = messages.map((m) => m.text).join("\n");
    expect(texte).not.toMatch(/place un ordre take profit/i);
    expect(texte).not.toMatch(/sécuriser le gain si l'objectif est atteint/i);
  });

  it("dit explicitement que les jalons ne sont pas des sorties", async () => {
    const messages = stub();
    await handleGuideCommand(env, 1);
    const texte = messages.map((m) => m.text).join("\n");
    expect(texte).toMatch(/jalons ne sont pas des sorties/i);
    expect(texte).toMatch(/suivre la progression/i);
  });

  it("annonce la sortie comme une DATE, pas comme un prix", async () => {
    const messages = stub();
    await handleGuideCommand(env, 1);
    const texte = messages.map((m) => m.text).join("\n");
    expect(texte).toMatch(/se ferme sur une\s+DATE/i);
    expect(texte).toContain("7 jours");
    expect(texte).toContain("3 jours");
  });

  it("explique le carry, qui n'a ni stop ni take profit", async () => {
    // Un abonné qui recevait son premier carry avec l'ancien guide en tête
    // cherchait un stop loss qui n'existe pas.
    const messages = stub();
    await handleGuideCommand(env, 1);
    const texte = messages.map((m) => m.text).join("\n");
    expect(texte).toMatch(/NI stop loss NI take profit/i);
    expect(texte).toContain("21 jours");
  });

  it("tient en trois étapes", async () => {
    const messages = stub();
    await handleGuideCommand(env, 1);
    const texte = messages.map((m) => m.text).join("\n");
    expect(texte).toContain("3 étapes");
    expect(texte).not.toMatch(/^\s*[4-9]\.\s/m);
  });

  it("porte un bouton d'action", async () => {
    const messages = stub();
    await handleGuideCommand(env, 1);
    expect(JSON.stringify(messages[0].keyboard)).toContain("start:demo");
  });

  it("survit à une base de données injoignable", async () => {
    // getLatestSignal échoue -> exemple de repli, la commande doit répondre.
    const messages: { text: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          messages.push({ text: JSON.parse(init!.body as string).text });
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error("supabase injoignable");
      })
    );
    await handleGuideCommand(env, 1);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].text).toMatch(/aucun signal réel émis/i);
  });
});
