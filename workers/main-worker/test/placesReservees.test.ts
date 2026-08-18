import { describe, it, expect, vi, afterEach } from "vitest";
import { peutPublier } from "../src/channelBudget";

/**
 * LE REMPLISSAGE MANGEAIT LA PLACE DES RENDEZ-VOUS QUOTIDIENS.
 *
 * La règle 3 en tête de channelBudget.ts — « quand la place manque, un signal
 * passe avant une anecdote » — n'existait qu'en commentaire. La table
 * `PRIORITE` était écrite dans une colonne et jamais relue pour décider.
 *
 * Relevé de `channel_posts` sur huit jours :
 *
 *     08-14   8 messages (7 incontournables + 1 éditorial)   bilan NON parti
 *     08-17   8 messages (6 incontournables + 2 éditoriaux)  bilan NON parti
 *     les autres jours, 6 ou 7 messages                      bilan parti
 *
 * Le défaut frappe LES JOURS OÙ TOUT VA BIEN : plus la stratégie émet, plus le
 * canal se remplit, et moins il peut expliquer ce qu'il fait.
 */

const db = { url: "https://fake.test", key: "k" } as never;

/** Simule une journée déjà chargée de `n` messages, dont `nEditorial` de remplissage. */
function journeeAvec(n: number, nEditorial = 0) {
  const posts = Array.from({ length: n }, (_, i) => ({
    categorie: i < nEditorial ? "editorial" : "resultat",
    // Anciens d'une heure : l'espacement n'interfère pas avec ce qu'on teste.
    sent_at: new Date(Date.now() - 3_600_000).toISOString(),
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(posts), { status: 200, headers: { "Content-Type": "application/json" } }))
  );
}

describe("Les rendez-vous quotidiens gardent leur place", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("LE DÉFAUT DU 17/08 : sept messages passés, le bilan quotidien doit encore pouvoir sortir", async () => {
    journeeAvec(7, 2);
    const verdict = await peutPublier(db, "public", "quotidien");
    expect(verdict.autorise, verdict.motif).toBe(true);
  });

  it("mais le remplissage, lui, s'arrête avant le plafond", async () => {
    // Même journée, même instant : une anecdote ou un rappel n'a plus sa place.
    // C'est la moitié qui manquait — sans elle, le remplissage prend la
    // huitième place et le bilan du soir se la voit refuser.
    journeeAvec(7, 1);
    const verdict = await peutPublier(db, "public", "editorial");
    expect(verdict.autorise).toBe(false);
    expect(verdict.motif).toContain("réservées");
  });

  it("le remplissage passe normalement tant que la journée est calme", async () => {
    // La correction ne doit pas museler le canal : cinq messages passés, il
    // reste de la place pour du contenu d'entretien.
    journeeAvec(5, 1);
    expect((await peutPublier(db, "public", "editorial")).autorise).toBe(true);
  });

  it("un signal reste incontournable même au-delà du plafond", async () => {
    // La contrepartie à ne jamais casser : un abonné paie pour les signaux et
    // leurs résultats. Ils échappent au plafond, et cette correction n'y touche
    // pas.
    journeeAvec(12, 2);
    expect((await peutPublier(db, "public", "signal")).autorise).toBe(true);
    expect((await peutPublier(db, "public", "resultat")).autorise).toBe(true);
  });

  it("le quota éditorial strict reste prioritaire sur la réserve", async () => {
    // Deux éditoriaux déjà partis sur un canal qui en autorise deux : refusé
    // pour cette raison-là, journée calme ou non.
    journeeAvec(3, 2);
    const verdict = await peutPublier(db, "public", "editorial");
    expect(verdict.autorise).toBe(false);
    expect(verdict.motif).toContain("éditorial");
  });
});
