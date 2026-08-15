import { describe, it, expect } from "vitest";
import { buildSignalMessage, ENGINE_BADGE } from "../src/signalFormat";
import { evaluateOutcome, computePnlPct, pnlEffectif } from "../src/signalMath";

/**
 * LE PRODUIT ÉMET DÉSORMAIS DES VENTES À DÉCOUVERT.
 *
 * C'est le premier signal de ce type depuis la création du service : tout ce
 * qui partait jusqu'ici était un ACHAT au comptant. Deux familles de risques
 * apparaissent avec lui, et ce fichier les verrouille toutes les deux.
 *
 * 1. LE RISQUE DE CALCUL. Un stop de vente est AU-DESSUS de l'entrée et les
 *    objectifs EN DESSOUS — l'inverse de tout ce que le code manipulait. Une
 *    inversion de signe quelque part afficherait un gain là où il y a une
 *    perte, ou clôturerait au mauvais moment.
 *
 * 2. LE RISQUE HUMAIN, et c'est le plus grave. Un achat au comptant ne peut
 *    pas descendre sous zéro ; une vente peut perdre SANS BORNE. Un abonné qui
 *    joue une vente sans stop, ou avec la taille d'un achat, peut perdre plus
 *    que sa mise. L'avertissement n'est donc pas une politesse réglementaire :
 *    c'est une pièce de sécurité, et sa PLACE dans le message compte autant
 *    que son existence.
 */

const vente = {
  type: "SELL" as const,
  pair: "SAND/USDT",
  entry_price: 0.2891,
  stop_loss: 0.3184,
  take_profit: 0.2305,
  tp1_price: 0.2598,
  tp2_price: 0.2305,
  tp3_price: 0.2012,
  created_at: "2026-08-15T08:41:00Z",
  engine: "faiblesse_4h",
  hold_until: "2026-08-18T08:41:00Z",
};

describe("La géométrie d'une vente est bien retournée", () => {
  it("place le stop AU-DESSUS et les objectifs EN DESSOUS de l'entrée", () => {
    expect(vente.stop_loss).toBeGreaterThan(vente.entry_price);
    expect(vente.tp1_price).toBeLessThan(vente.entry_price);
    expect(vente.tp3_price).toBeLessThan(vente.tp1_price);
  });

  it("compte un gain quand le prix BAISSE", () => {
    // L'erreur de signe la plus coûteuse possible : annoncer une perte comme
    // un gain, ou l'inverse, sur un moteur entier.
    expect(computePnlPct("SELL", 0.2891, 0.2598)).toBeGreaterThan(0);
    expect(computePnlPct("SELL", 0.2891, 0.3184)).toBeLessThan(0);
  });

  it("clôture en WIN sur l'objectif et en LOSS sur le stop", () => {
    const surObjectif = evaluateOutcome("SELL", vente.stop_loss, vente.take_profit, 0.2300);
    const surStop = evaluateOutcome("SELL", vente.stop_loss, vente.take_profit, 0.3200);
    expect(surObjectif?.outcome).toBe("WIN");
    expect(surStop?.outcome).toBe("LOSS");
  });

  it("mélange correctement les sorties partielles d'une vente", () => {
    // 30 % sortis à TP1 (+10,1 %), le reste à 0.2700 (+6,6 %).
    const avecTp1 = { ...vente, tp1_hit_at: "2026-08-16T00:00:00Z", tp2_hit_at: null };
    const melange = pnlEffectif(avecTp1, 0.27);
    expect(melange).toBeGreaterThan(computePnlPct("SELL", vente.entry_price, 0.27));
  });
});

describe("L'avertissement de vente à découvert", () => {
  it("est présent, et nomme les trois choses qui peuvent ruiner quelqu'un", () => {
    const texte = buildSignalMessage(vente as never);
    expect(texte).toMatch(/compte à terme/);        // il faut un compte futures
    expect(texte).toMatch(/SANS LIMITE/);           // perte non bornée
    expect(texte).toMatch(/squeeze/i);              // le stop peut être franchi
  });

  it("passe AVANT les niveaux, pas après", () => {
    // Un avertissement placé sous une espérance de +1,10 % se lit après que le
    // lecteur a décidé — c'est-à-dire jamais. Sa position est une propriété du
    // produit, pas une préférence de mise en page.
    const texte = buildSignalMessage(vente as never);
    const posAvertissement = texte.indexOf("VENTE À DÉCOUVERT");
    const posNiveaux = texte.indexOf("Zone d'entrée");
    expect(posAvertissement).toBeGreaterThan(-1);
    expect(posAvertissement, "l'avertissement est passé sous les niveaux").toBeLessThan(posNiveaux);
  });

  it("laisse une porte de sortie explicite", () => {
    // Un abonné qui ne peut pas ou ne veut pas shorter doit savoir qu'il ne
    // perd pas le reste du service en ignorant ce signal.
    expect(buildSignalMessage(vente as never)).toMatch(/ignore ce signal/);
  });

  it("n'apparaît JAMAIS sur un achat", () => {
    const achat = { ...vente, type: "BUY" as const, engine: "momentum_4h", stop_loss: 0.26, tp1_price: 0.31 };
    expect(buildSignalMessage(achat as never)).not.toMatch(/VENTE À DÉCOUVERT/);
  });
});

describe("Le moteur est identifiable", () => {
  it("porte son propre badge, pas le badge neutre", () => {
    // Un moteur absent de la table recevrait « 📊 Signal » : l'abonné ne
    // saurait pas d'où vient le signal, et le relevé par moteur serait faux.
    expect(ENGINE_BADGE["faiblesse_4h"]).toBe("🔻 Faiblesse 4H");
    expect(buildSignalMessage(vente as never)).toContain("🔻 Faiblesse 4H");
  });

  it("dit que la tendance du marché joue POUR lui", () => {
    // C'est sa raison d'être et sa différence avec les quatre autres moteurs.
    expect(buildSignalMessage(vente as never)).toMatch(/POUR lui/);
  });
});
