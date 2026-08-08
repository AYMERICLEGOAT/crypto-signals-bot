import { describe, it, expect, vi, afterEach } from "vitest";
import { handleFaqCommand } from "../src/bot/commands/faq";
import { sendReengagementOffers } from "../src/cron/reengagementOffer";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_URL: "https://t.me/ProSignauxPublic",
} as any;

describe("/faq — traitement des objections (audit du 01/08/2026)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("répond franchement sur la rentabilité au lieu de l'éluder", async () => {
    // Les messages sont ACCUMULÉS, pas écrasés. Écraser ne conservait que le
    // dernier envoi : le jour où la FAQ est passée de deux parties à trois,
    // le test s'est mis à ne relire qu'un fragment et a échoué sur du contenu
    // pourtant bien présent.
    const envoyes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          envoyes.push(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleFaqCommand(env, 1);
    const sent = envoyes.join("\n");

    expect(sent).toContain("Nous ne le promettons pas");
    expect(sent).toContain("n'a pas démontré");
    // L'objection "arnaque" est traitée de front, pas contournée.
    expect(sent).toContain("arnaque");
    // Le piège du taux de réussite est expliqué chiffres à l'appui.
    expect(sent).toContain("70% de réussite");
  });

  it("ne dit plus que le filtre fermé signifie zéro signal", async () => {
    // C'était la croyance qui fait résilier, et elle est fausse depuis le
    // momentum 4H — qui ne travaille QUE dans ce régime.
    const envoyes: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          envoyes.push(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleFaqCommand(env, 1);
    const sent = envoyes.join("\n");

    expect(sent).not.toMatch(/zéro, sans exception/i);
    expect(sent).toMatch(/Fermé ne veut donc pas dire silence complet/i);
  });

  it("découpe lui-même ses messages au lieu de subir la coupure de Telegram", async () => {
    // Chaque partie doit tenir sous la limite : au-dessus, splitMessage()
    // coupe au dernier saut de ligne et produit un fragment orphelin — c'est
    // arrivé, avec 173 caractères isolés.
    const tailles: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          tailles.push(JSON.parse(init!.body as string).text.length);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleFaqCommand(env, 1);

    expect(tailles).toHaveLength(3);
    for (const taille of tailles) {
      expect(taille).toBeLessThan(4096);
      // Aucun fragment orphelin : une partie de FAQ fait au moins un écran.
      expect(taille).toBeGreaterThan(800);
    }
  });

  it("n'utilise pas Markdown — un seul caractère mal échappé ferait tomber tout le message", async () => {
    let payload: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          payload = JSON.parse(init!.body as string);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url}`);
      })
    );

    await handleFaqCommand(env, 1);
    expect(payload.parse_mode).toBeUndefined();
  });
});

describe("Relance de réengagement — récapitulatif honnête", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(resolvedSignals: unknown[], onSend: (t: string) => void) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const isGet = !init || init.method === undefined;
        if (url.includes("/users") && isGet) {
          return jsonResponse([{ telegram_id: 42, expiration: "2026-07-20T00:00:00Z" }]);
        }
        if (url.includes("/signals") && isGet) return jsonResponse(resolvedSignals);
        if (url.includes("/users") && init?.method === "PATCH") return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          onSend(JSON.parse(init!.body as string).text);
          return jsonResponse({ ok: true, result: {} });
        }
        throw new Error(`URL inattendue: ${url} ${init?.method}`);
      })
    );
  }

  it("inclut les PERTES autant que les gains", async () => {
    let sent = "";
    stub(
      [
        { id: 1, pair: "BTC/USDT", type: "BUY", entry_price: 100, outcome: "WIN", outcome_price: 110 },
        { id: 2, pair: "ETH/USDT", type: "BUY", entry_price: 200, outcome: "LOSS", outcome_price: 180 },
      ],
      (t) => (sent = t)
    );

    await sendReengagementOffers(env);

    expect(sent).toContain("BTC/USDT");
    expect(sent).toContain("ETH/USDT");
    expect(sent).toContain("✅");
    expect(sent).toContain("❌"); // la perte est bien montrée
    expect(sent).toContain("1 gagnant(s), 1 perdant(s)");
    expect(sent).toContain("RELANCE50");
  });

  it("calcule correctement le pourcentage d'une VENTE (inversé par rapport à un achat)", async () => {
    let sent = "";
    stub(
      [{ id: 1, pair: "SOL/USDT", type: "SELL", entry_price: 100, outcome: "WIN", outcome_price: 90 }],
      (t) => (sent = t)
    );

    await sendReengagementOffers(env);
    expect(sent).toContain("+10.0%"); // vendre à 100 et racheter à 90 = +10%
  });

  it("envoie quand même la relance si aucun signal n'a été clôturé", async () => {
    let sent = "";
    stub([], (t) => (sent = t));

    await sendReengagementOffers(env);

    expect(sent).toContain("RELANCE50");
    expect(sent).not.toContain("Voilà ce qui s'est clôturé");
  });

  it("ne fait aucune requête si personne n'est concerné", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/users")) return jsonResponse([]);
      throw new Error(`Ne devrait pas être appelé: ${url}`);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await sendReengagementOffers(env);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // la lecture des expirés, rien de plus
  });
});
