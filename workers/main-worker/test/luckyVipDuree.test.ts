import { describe, it, expect, vi, afterEach } from "vitest";
import { runLuckyVipDay } from "../src/cron/luckyVipDay";

/**
 * LE MESSAGE ANNONÇAIT 24 H, LE CODE EN ACCORDAIT JUSQU'À TROIS.
 *
 * Le gagnant est tiré parmi les essais ACTIFS, et un essai dure trois jours.
 * Son expiration est donc presque toujours postérieure à +24 h — et c'est
 * elle qui est conservée, puisque la règle est de ne jamais raccourcir. Le
 * plan Pro courait ainsi jusqu'au bout de l'essai pendant que le message
 * parlait de vingt-quatre heures.
 *
 * L'écart jouait en faveur de l'utilisateur, et c'est exactement pour ça
 * qu'il pouvait durer : personne ne signale recevoir plus que promis. Il
 * restait un endroit où le système affirmait une chose et en faisait une
 * autre, dans un produit dont l'argument est la rigueur de la mesure.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
} as never;

/**
 * Monte un tirage avec UN seul candidat, dont l'essai se termine dans
 * `finEssaiHeures`. Rend le message envoyé et la ligne écrite en base.
 */
async function tirage(finEssaiHeures: number) {
  const expiration = new Date(Date.now() + finEssaiHeures * 3_600_000).toISOString();
  let message = "";
  let ecrit: Record<string, unknown> = {};

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        message = String(JSON.parse(init!.body as string).text ?? "");
        return jsonResponse({ ok: true, result: {} });
      }
      // Aucun tirage aujourd'hui.
      if (url.includes("lucky_vip_draws") && (!init || init.method === undefined)) return jsonResponse([]);
      if (url.includes("lucky_vip_draws")) return jsonResponse([{}]);
      if (url.includes("users") && init?.method === "PATCH") {
        ecrit = JSON.parse(init.body as string);
        return jsonResponse([{}]);
      }
      if (url.includes("users")) {
        return jsonResponse([{ telegram_id: 42, plan: 0, expiration }]);
      }
      return jsonResponse([]);
    })
  );

  await runLuckyVipDay(env);
  return { message, ecrit };
}

describe("Lucky VIP Day annonce la durée réellement accordée", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne dit plus « 24h » quand l'essai en cours court encore trois jours", async () => {
    // LE DÉFAUT EXACT : essai actif jusqu'à +70 h. L'expiration n'étant jamais
    // raccourcie, l'accès Pro court jusque-là — et le message disait 24 h.
    const { message, ecrit } = await tirage(70);

    expect(message).not.toContain("24h");
    expect(message).toContain("3 prochains jours");
    // La base confirme l'écart : c'est bien l'expiration de l'essai qui est
    // conservée, pas une échéance à 24 h.
    const ecriteHeures = (new Date(String(ecrit.expiration)).getTime() - Date.now()) / 3_600_000;
    expect(ecriteHeures).toBeGreaterThan(48);
  });

  it("annonce bien 24 heures quand c'est réellement ce qui est accordé", async () => {
    // Essai qui se termine dans 3 h : +24 h est plus loin, donc c'est +24 h qui
    // est écrit. Là, l'ancien message était exact — la correction ne doit pas
    // l'avoir cassé.
    const { message, ecrit } = await tirage(3);

    expect(message).toContain("24 prochaines heures");
    const ecriteHeures = (new Date(String(ecrit.expiration)).getTime() - Date.now()) / 3_600_000;
    expect(ecriteHeures).toBeGreaterThan(23);
    expect(ecriteHeures).toBeLessThan(25);
  });

  it("n'écourte jamais l'accès déjà acquis", async () => {
    // La règle de fond du module. Un essai plus long que 24 h doit survivre au
    // tirage : le cadeau ne peut pas coûter du temps à celui qui le reçoit.
    const { ecrit } = await tirage(70);
    const ecriteHeures = (new Date(String(ecrit.expiration)).getTime() - Date.now()) / 3_600_000;
    expect(ecriteHeures).toBeGreaterThan(69);
  });
});
