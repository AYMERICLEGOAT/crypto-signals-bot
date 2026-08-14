import { describe, it, expect } from "vitest";
import { buildSignalMessage } from "../src/signalFormat";

/**
 * LA PROMESSE ET LE RELEVÉ PARTENT ENSEMBLE.
 *
 * Chaque signal du momentum 4H porte « +0,805 % par signal sur 3 jours
 * mesurés » — la mesure du backtest sur 1 100 jours, et elle est exacte. Le
 * relevé RÉEL du même moteur, au 14/08/2026, dit autre chose : 10 clôtures,
 * 3 gagnants, −0,07 % par trade. Ce second chiffre n'apparaissait nulle part.
 *
 * Taire un chiffre défavorable qu'on possède est la forme la plus facile du
 * mensonge sur les performances : elle ne demande aucun effort et ne laisse
 * aucune trace. Sur un produit dont l'argument central est la rigueur de la
 * mesure, c'est aussi la plus coûteuse le jour où quelqu'un recompte.
 */

const momentum = {
  type: "BUY" as const,
  pair: "SOL/USDT",
  entry_price: 75.63,
  stop_loss: 72.1936,
  take_profit: 85.9391,
  tp1_price: 79.0664,
  tp2_price: 82.5027,
  tp3_price: 85.9391,
  created_at: "2026-08-13T03:13:39Z",
  engine: "momentum_4h",
  hold_until: "2026-08-16T03:13:39Z",
};

describe("Le relevé réel accompagne la promesse du moteur", () => {
  it("publie le chiffre défavorable sans l'adoucir", () => {
    const texte = buildSignalMessage(momentum as never, {
      releveReel: { clotures: 10, moyennePct: -0.07, gagnants: 3 },
    });
    expect(texte).toContain("-0,07 %");
    expect(texte).toContain("10 clôtures");
    expect(texte).toContain("3 gagnantes");
    // La promesse reste : on ne remplace pas un chiffre par l'autre, on
    // publie les deux.
    expect(texte).toContain("+1,86 %");
  });

  it("dit que l'échantillon est trop petit pour conclure", () => {
    // Sans cette phrase, dix trades se liraient comme un verdict. Le garde-fou
    // d'espérance exige trente clôtures avant de couper, précisément parce
    // qu'en dessous la moyenne est du bruit.
    const texte = buildSignalMessage(momentum as never, {
      releveReel: { clotures: 10, moyennePct: -0.07, gagnants: 3 },
    });
    expect(texte).toMatch(/trop petit pour conclure/);
  });

  it("publie aussi un relevé FAVORABLE, sans triomphalisme", () => {
    const texte = buildSignalMessage(momentum as never, {
      releveReel: { clotures: 12, moyennePct: 1.4, gagnants: 8 },
    });
    expect(texte).toContain("+1,40 %");
    expect(texte).toMatch(/trop petit pour confirmer/);
  });

  it("n'affiche RIEN quand le relevé est absent", () => {
    // Une lecture Supabase en échec ne doit jamais empêcher un signal de
    // partir, ni produire une ligne vide ou un « undefined ».
    const texte = buildSignalMessage(momentum as never, { releveReel: null });
    expect(texte).not.toContain("Relevé RÉEL");
    expect(texte).not.toContain("undefined");
    expect(texte).toContain("+1,86 %"); // le message reste complet par ailleurs
  });

  it("ne concerne QUE le momentum 4H", () => {
    // Les autres moteurs n'ont pas d'étiquette « en observation » et leur
    // relevé n'est pas encore instrumenté : y coller cette ligne serait un
    // chiffre sans son contexte.
    const autre = { ...momentum, engine: "relative_strength" };
    const texte = buildSignalMessage(autre as never, {
      releveReel: { clotures: 10, moyennePct: -0.07, gagnants: 3 },
    });
    expect(texte).not.toContain("Relevé RÉEL");
  });
});

describe("Le dimensionnement avertit du cumul des positions", () => {
  it("dit que le calcul porte sur un seul trade", () => {
    // Le 13/08, le message SOL annonçait « environ 44 % de ton capital TOTAL »
    // alors que six positions étaient ouvertes. Appliquer la formule à chacune
    // mène au-delà de 200 % du capital — c'est-à-dire à emprunter pour suivre
    // un signal présenté comme prudent.
    const texte = buildSignalMessage(momentum as never);
    expect(texte).toContain("CE trade isolément");
    expect(texte).toMatch(/ne doit jamais dépasser ton capital/);
  });
});
