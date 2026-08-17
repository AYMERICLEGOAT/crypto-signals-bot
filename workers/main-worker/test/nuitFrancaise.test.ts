import { describe, it, expect } from "vitest";
import { isQuietHours, QUIET_START_UTC, QUIET_END_UTC } from "../src/utils/quietHours";

/**
 * LA FENÊTRE DE SILENCE ÉTAIT RAISONNÉE EN UTC, PAS DEPUIS LE TÉLÉPHONE DU
 * LECTEUR.
 *
 * Le module a été écrit après un retour explicite — « des messages partaient à
 * 2 h du matin » — et sa borne a été posée à 23 h UTC. Or 23 h UTC, c'est 1 h
 * du matin à Paris en été. La plage 22 h – 1 h, heure française, restait donc
 * entièrement ouverte, et le 17/08/2026 le canal public y a notifié une
 * clôture à 0 h 55.
 *
 * Ce test raisonne en heure de PARIS, parce que c'est la seule qui compte : un
 * abonné qui se fait réveiller ne consulte pas la table UTC, il coupe les
 * notifications. Et une mise en sourdine ne se défait jamais.
 */

/** L'heure UTC correspondant à une heure de Paris donnée. */
function utcDepuisParis(heureParis: number, minutes: number, ete: boolean): Date {
  const decalage = ete ? 2 : 1;
  const d = new Date(Date.UTC(2026, 7, 17, heureParis - decalage, minutes));
  return d;
}

describe("Le canal public se tait pendant la nuit FRANÇAISE", () => {
  it("se tait à 0 h 55 à Paris — l'heure exacte du défaut du 17/08", () => {
    // Le message réellement parti : « ❌ Signal clôturé » à 00:55, heure de
    // Paris. Avec la borne à 23 h UTC, cet envoi était parfaitement légal.
    expect(isQuietHours(utcDepuisParis(0, 55, true))).toBe(true);
  });

  it("se tait sur toute la plage 23 h – 8 h à Paris, été comme hiver", () => {
    for (const ete of [true, false]) {
      for (const h of [23, 0, 1, 2, 3, 4, 5, 6, 7]) {
        const quand = utcDepuisParis(h, 30, ete);
        expect(isQuietHours(quand), `${h} h 30 à Paris (${ete ? "été" : "hiver"})`).toBe(true);
      }
    }
  });

  it("parle encore aux heures ouvrables, et jusqu'en début de soirée", () => {
    // La contrepartie : resserrer la nuit ne doit pas amputer la journée. Les
    // rendez-vous planifiés du produit tombent à 8 h, 10 h et 18 h UTC —
    // c'est-à-dire 10 h, 12 h et 20 h à Paris en été.
    for (const ete of [true, false]) {
      for (const h of [9, 10, 12, 15, 18, 20, 21]) {
        const quand = utcDepuisParis(h, 30, ete);
        expect(isQuietHours(quand), `${h} h 30 à Paris (${ete ? "été" : "hiver"})`).toBe(false);
      }
    }
  });

  it("laisse passer les trois rendez-vous planifiés du produit", () => {
    // Briefing VIP (8 h), récap mensuel (10 h), bilan de sélectivité et récap
    // hebdo (18 h). Si l'un d'eux tombait dans la fenêtre, il ne partirait
    // plus jamais — en silence, comme toujours.
    for (const heureUtc of [8, 10, 18]) {
      expect(isQuietHours(new Date(Date.UTC(2026, 7, 17, heureUtc, 5))), `${heureUtc} h UTC`).toBe(false);
    }
  });

  it("garde une fenêtre de silence d'un seul tenant", () => {
    // Garde-fou d'écriture : la fonction enjambe minuit. Une borne de début
    // passée sous celle de fin inverserait la logique sans que rien n'échoue.
    expect(QUIET_START_UTC).toBeGreaterThan(QUIET_END_UTC);
    expect(QUIET_END_UTC).toBeGreaterThan(0);
  });
});
