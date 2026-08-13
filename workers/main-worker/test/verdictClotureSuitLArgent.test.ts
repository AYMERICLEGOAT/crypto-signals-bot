import { describe, it, expect } from "vitest";
import { pnlEffectif } from "../src/signalMath";

/**
 * LE CANAL PUBLIC A PUBLIÉ UNE ÉTIQUETTE NÉGATIVE SUR UN NOMBRE POSITIF.
 *
 * Relevé réel du 12/08/2026, canal ProSignauxGratuits :
 *
 *   ❌ Signal clôturé — perdant
 *   ACHAT TAO/USDT — sortie à 204.35 (+0.3%)
 *
 * Et la veille, BNB était sorti à +1,40 % en comptant lui aussi comme une
 * perte. La règle appliquée était « TP1 sécurisé -> gagnant, sinon perdant »,
 * appliquée à toute clôture à l'échéance sans regarder le résultat.
 *
 * Elle se réclamait pourtant de signals/backtest.py, dont la convention écrite
 * dit l'inverse : « outcome = WIN si TP1 a été atteint OU SI LE PNL FINAL EST
 * POSITIF ». La seconde moitié de la règle avait disparu du portage. Le relevé
 * publié était donc plus mauvais que la stratégie mesurée, et incohérent avec
 * le backtest que le produit cite dans ses propres messages.
 *
 * Second défaut du même message : le pourcentage ignorait les sorties
 * partielles. ICP a été publié à « +1,7 % » alors que 30 % de la position
 * étaient sortis à TP1 (+6,16 %) — le rendement réel valait +3,06 %. Le canal
 * publiait un chiffre deux fois plus bas que le résultat de sa propre méthode.
 */

describe("Le rendement publié tient compte des sorties partielles", () => {
  // Les niveaux RÉELS du signal ICP #29, tels qu'ils ont été envoyés.
  const icp = {
    type: "BUY" as const,
    entry_price: 2.2,
    tp1_price: 2.33562942,
    tp2_price: 2.47125884,
    tp1_hit_at: "2026-08-11T09:00:00Z",
    tp2_hit_at: null,
  };

  it("mélange la sortie de TP1 avec la sortie finale", () => {
    // 30 % sortis à 2.3356 (+6,16 %), 70 % sortis à 2.238 (+1,73 %).
    // 0,3 x 6,16 + 0,7 x 1,73 = 3,06.
    expect(pnlEffectif(icp, 2.238)).toBeCloseTo(3.06, 1);
  });

  it("ne compte QUE la sortie finale quand aucun palier n'a été touché", () => {
    const sansPalier = { ...icp, tp1_hit_at: null };
    expect(pnlEffectif(sansPalier, 2.238)).toBeCloseTo(1.73, 2);
  });

  it("reste positif quand TP1 est sécurisé et que le prix retombe à l'entrée", () => {
    // C'est toute la raison d'être du break-even : le gain de TP1 est acquis,
    // le reste sort à zéro. Publier « 0 % » serait faux.
    expect(pnlEffectif(icp, 2.2)).toBeCloseTo(0.3 * 6.16, 1);
  });

  it("additionne TP1 et TP2 quand les deux sont touchés", () => {
    const deuxPaliers = { ...icp, tp2_hit_at: "2026-08-11T15:00:00Z" };
    // 0,3 x 6,16 + 0,3 x 12,33 + 0,4 x 1,73 = 6,24.
    expect(pnlEffectif(deuxPaliers, 2.238)).toBeCloseTo(6.24, 1);
  });

  it("rend une perte négative, sans adoucissement", () => {
    // La symétrie compte autant que le reste : un produit qui n'arrondirait
    // que ses gains vers le haut ne prouverait rien.
    const sansPalier = { ...icp, tp1_hit_at: null };
    expect(pnlEffectif(sansPalier, 2.0)).toBeLessThan(0);
  });

  it("gère une VENTE dans le bon sens", () => {
    const vente = { ...icp, type: "SELL" as const, tp1_hit_at: null };
    expect(pnlEffectif(vente, 2.0)).toBeGreaterThan(0);
  });

  it("ne casse pas sur un prix de sortie absent", () => {
    expect(pnlEffectif(icp, null)).toBe(0);
  });
});
