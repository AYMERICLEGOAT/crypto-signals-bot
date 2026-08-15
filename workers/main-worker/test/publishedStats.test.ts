import { describe, it, expect } from "vitest";
import { DEBIT, MAX_PAR_JOUR, PART_FILTRE_FERME, PART_JOURS_AVEC_SIGNAL } from "../src/publishedStats";

/**
 * Ce fichier existe à cause d'une panne silencieuse.
 *
 * Le produit a annoncé « 4,35 signaux par jour » pendant des semaines après
 * l'ajout de deux moteurs qui ont changé ce chiffre. Rien ne pouvait
 * l'attraper : ajouter un moteur ne casse aucun test et ne touche aucun des
 * vingt textes qui recopiaient le nombre à la main.
 *
 * On vérifie donc deux choses qu'un humain ne relira pas : que les anciens
 * littéraux ont bien disparu des textes envoyés, et que les nouveaux chiffres
 * restent cohérents entre eux.
 */

// Le pool Workers n'expose aucun accès disque (`readdirSync` n'y est pas
// implémenté). `import.meta.glob` fait le travail au moment du build : Vite
// inline le contenu des sources dans le bundle de test.
const SOURCES = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

describe("Les chiffres périmés ne doivent pas revenir dans les textes", () => {
  // Mesurés à DEUX moteurs (force relative + carry), publiés alors que cinq
  // émettaient. Voir publishedStats.ts pour le détail.
  // Les trois premiers datent de l'époque à deux moteurs. Le quatrième est
  // plus ancien encore — il décrivait le moteur à famille UNIQUE, et il avait
  // été « retiré partout » selon un commentaire du site : il survivait en
  // réalité dans /faq et dans un message diffusé au canal public.
  const PERIMES = ["4,35", "2,99 signaux", "1,15 signal par jour", "8,0 signaux par semaine", "8,0 par semaine"];

  it("le scan couvre réellement les sources", () => {
    // Sans ce garde-fou, un glob qui ne correspond à rien rendrait le test
    // suivant vert pour toujours — la panne exacte qu'il est censé empêcher.
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
  });

  it("aucun fichier source ne recopie un ancien débit", () => {
    const coupables: string[] = [];
    for (const [chemin, contenu] of Object.entries(SOURCES)) {
      // publishedStats.ts CITE ces chiffres pour expliquer d'où ils viennent.
      // C'est le seul endroit où ils ont encore le droit d'apparaître.
      if (chemin.endsWith("publishedStats.ts")) continue;
      for (const perime of PERIMES) {
        if (contenu.includes(perime)) coupables.push(`${chemin} contient "${perime}"`);
      }
    }
    expect(coupables).toEqual([]);
  });
});

describe("Cohérence interne des chiffres publiés", () => {
  // « 42 % » et « 4,0 » : on retire l'unité et l'espace insécable avant de
  // convertir, sinon Number() rend NaN et toutes les comparaisons passent.
  const nombre = (s: string) => Number(s.replace(",", ".").replace(/[^0-9.]/g, ""));

  it("les deux régimes produisent un débit comparable", () => {
    // CET INVARIANT A ÉTÉ RENVERSÉ LE 15/08/2026, ET C'EST VOULU.
    //
    // Il exigeait « défavorable < favorable », au motif que les trois moteurs
    // directionnels sont coupés quand le filtre se ferme. C'était vrai tant que
    // le produit était long-only : le régime baissier était forcément le creux.
    //
    // Le moteur Faiblesse 4H ne travaille QUE dans ce régime et y produit 1,97
    // signal par jour à lui seul. Le creux historique du produit (2,2) est
    // devenu son sommet (4,1). Ce n'est pas une erreur de report — c'était tout
    // l'objet de l'ajout : une fermeture de filtre peut durer 381 jours, et
    // l'abonné payait pendant ce temps pour un service presque muet.
    //
    // Ce qui reste à vérifier n'est donc plus un ordre mais un ÉCART : si les
    // deux régimes divergeaient fortement, le produit redeviendrait irrégulier.
    const ecart = Math.abs(nombre(DEBIT.defavorable) - nombre(DEBIT.favorable));
    expect(ecart, "les deux régimes ne délivrent plus un service comparable").toBeLessThan(1);
  });

  it("la moyenne reste encadrée par les deux régimes", () => {
    const bas = Math.min(nombre(DEBIT.defavorable), nombre(DEBIT.favorable));
    const haut = Math.max(nombre(DEBIT.defavorable), nombre(DEBIT.favorable));
    expect(nombre(DEBIT.moyenne)).toBeGreaterThanOrEqual(bas);
    expect(nombre(DEBIT.moyenne)).toBeLessThanOrEqual(haut);
  });

  it("la moyenne est cohérente avec la part de temps passée dans chaque régime", () => {
    // 42 % du temps en défavorable, 58 % en favorable.
    const partFermee = nombre(PART_FILTRE_FERME) / 100;
    const attendue = partFermee * nombre(DEBIT.defavorable) + (1 - partFermee) * nombre(DEBIT.favorable);
    expect(Math.abs(attendue - nombre(DEBIT.moyenne))).toBeLessThan(0.15);
  });

  it("aucun débit moyen ne dépasse le maximum absolu", () => {
    expect(nombre(DEBIT.favorable)).toBeLessThan(MAX_PAR_JOUR);
  });

  it("les pourcentages restent des pourcentages", () => {
    for (const p of [PART_FILTRE_FERME, PART_JOURS_AVEC_SIGNAL]) {
      expect(nombre(p)).toBeGreaterThan(0);
      expect(nombre(p)).toBeLessThanOrEqual(100);
    }
  });
});
