import { describe, it, expect, vi, afterEach } from "vitest";
import { handleAntiStress } from "../src/cron/antiStress";

/**
 * QUATRE AFFIRMATIONS FAUSSES, TROUVÉES DANS UN RELEVÉ RÉEL DU 17/08/2026.
 *
 * Aucune n'a fait échouer quoi que ce soit. Les messages sont partis, ont été
 * délivrés, et disaient des choses inexactes à des lecteurs qui n'avaient
 * aucun moyen de le savoir. C'est la forme de défaut la plus coûteuse sur un
 * produit dont l'argument central est la rigueur de la mesure : elle ne casse
 * rien, elle décrédibilise.
 *
 * Ce fichier verrouille les deux qui se testent en isolation. Les deux autres
 * — la note de report et le relevé réel sur le canal public — sont couvertes
 * par leurs modules respectifs.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
} as never;

function stub() {
  const messages: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        messages.push(String(JSON.parse(init!.body as string).text ?? ""));
        return jsonResponse({ ok: true, result: {} });
      }
      // Un abonné PAYANT : la célébration ne part qu'à eux (plan != essai).
      if (url.includes("/users")) {
        return jsonResponse([{ telegram_id: 42, plan: 1, consecutive_losses: 0 }]);
      }
      return jsonResponse([]);
    })
  );
  return messages;
}

describe("La félicitation dit ce qui s'est réellement passé", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne parle PAS de take profit quand le signal a expiré", async () => {
    // LE DÉFAUT EXACT. Le 17/08 à 00:55, un abonné a reçu :
    //
    //   ⌛ Clôturé à l'échéance — en gain
    //   ACHAT ICP/USDT — clôturé à 2.236 (+2,8 %). ... sans avoir touché ni
    //   l'objectif ni le stop.
    //   🎉 Take profit dans la poche !
    //
    // Deux messages consécutifs, à une seconde d'intervalle, qui se
    // contredisent — dont l'un félicite pour un événement qui n'a pas eu lieu.
    // L'objectif était à 2.3541, la sortie à 2.236.
    const messages = stub();
    await handleAntiStress(env, [42], "WIN", "expired");
    const celebration = messages.find((m) => m.includes("clôturée en gain") || m.includes("Take profit"));
    expect(celebration, "aucune félicitation envoyée").toBeDefined();
    expect(celebration).not.toContain("Take profit dans la poche");
    expect(celebration).toMatch(/n'a pas touché son objectif/);
  });

  it("parle bien de take profit quand l'objectif est VRAIMENT touché", async () => {
    // La correction ne doit pas retirer la félicitation légitime : quand le
    // trade a réellement atteint son objectif, le dire est exact et mérité.
    const messages = stub();
    await handleAntiStress(env, [42], "WIN", "tp_hit");
    expect(messages.some((m) => m.includes("Take profit dans la poche"))).toBe(true);
  });

  it("reste prudent quand le motif est inconnu", async () => {
    // Sans motif, on ne peut pas affirmer qu'un objectif a été touché. Le repli
    // doit donc être la formulation NEUTRE, jamais la plus flatteuse — c'est le
    // sens de dégradation qui protège de la fausseté.
    const messages = stub();
    await handleAntiStress(env, [42], "WIN", undefined);
    expect(messages.some((m) => m.includes("Take profit dans la poche"))).toBe(false);
  });

  it("ne félicite jamais sur une perte", async () => {
    const messages = stub();
    await handleAntiStress(env, [42], "LOSS", "sl_hit");
    expect(messages.some((m) => m.includes("Take profit") || m.includes("clôturée en gain"))).toBe(false);
  });
});
