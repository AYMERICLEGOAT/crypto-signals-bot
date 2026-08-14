import { describe, it, expect } from "vitest";
import { buildSignalMessage, ENGINE_BADGE } from "../src/signalFormat";
import { MOMENTUM_4H } from "../src/publishedStats";

/**
 * Chaque signal doit dire de quel moteur il vient.
 *
 * Le produit en compte cinq, dont un explicitement présenté « en
 * observation ». Un signal sans étiquette met l'abonné dans l'impossibilité de
 * savoir si ce qu'il reçoit relève du moteur le mieux établi du projet ou de
 * celui dont l'avantage est le moins certain — alors que le produit répète
 * partout que la différence compte.
 *
 * Le risque est concret : la cassure de canal et l'expansion de volatilité ont
 * été branchées APRÈS la mise en place du formatage. Un moteur ajouté sans son
 * étiquette ne casse rien, il produit juste des signaux anonymes.
 */

const MOTEURS = [
  "relative_strength",
  "carry_funding",
  "momentum_4h",
  "cassure_canal",
  "expansion_volatilite",
] as const;

function signal(engine: string) {
  return {
    type: "BUY" as const,
    pair: "BTC/USDT",
    entry_price: 60000,
    stop_loss: 58800,
    take_profit: 62640,
    tp1_price: 60800,
    tp2_price: 62640,
    tp3_price: 64000,
    created_at: "2026-08-08T00:00:00Z",
    engine,
  };
}

describe("Étiquetage des moteurs", () => {
  it("les cinq moteurs de production ont une étiquette", () => {
    for (const moteur of MOTEURS) {
      expect(ENGINE_BADGE[moteur], `étiquette manquante pour ${moteur}`).toBeTruthy();
    }
  });

  it("aucune étiquette n'est partagée entre deux moteurs", () => {
    const etiquettes = MOTEURS.map((m) => ENGINE_BADGE[m]);
    expect(new Set(etiquettes).size).toBe(MOTEURS.length);
  });

  it("l'étiquette apparaît dans le message envoyé", () => {
    for (const moteur of MOTEURS) {
      const message = buildSignalMessage(signal(moteur) as any);
      // On compare sur le texte sans l'emoji : le formatage peut échapper des
      // caractères Markdown, l'emoji non.
      const attendu = ENGINE_BADGE[moteur].replace(/[^\p{L} 0-9()]/gu, "").trim();
      expect(message, `moteur ${moteur} non identifiable dans son message`).toContain(attendu.split(" ")[0]);
    }
  });

  it("le momentum 4H publie sa réserve dans le CORPS du signal", () => {
    // La réserve était collée au nom du moteur dans le badge, si bien que
    // chaque signal s'ouvrait sur une mise en garde avant qu'un seul chiffre
    // soit lu — alors que ce moteur rend environ neuf fois le carry par jour
    // de capital immobilisé.
    //
    // Ce qui doit être garanti n'est pas l'endroit, c'est la PRÉSENCE : la
    // mesure complète et sa limite doivent figurer là où quelqu'un décide
    // d'engager de l'argent, c'est-à-dire dans le message du signal.
    const message = buildSignalMessage(signal("momentum_4h") as any);
    expect(message).toMatch(/tirage au sort/i);
    expect(message).toMatch(/une place par jour/i);
    expect(message).toContain(MOMENTUM_4H.esperanceParJour);
  });

  it("un moteur inconnu ne fait pas tomber le message", () => {
    // Un signal arrivant d'un moteur non répertorié doit rester délivrable :
    // perdre le signal serait pire que perdre son étiquette.
    expect(() => buildSignalMessage(signal("moteur_inexistant") as any)).not.toThrow();
    expect(buildSignalMessage(signal("moteur_inexistant") as any)).toContain("BTC/USDT");
  });
});

describe("Le repli d'étiquette ne promet rien", () => {
  it("un moteur inconnu n'est PAS présenté comme « Haute Confiance »", () => {
    // C'était le comportement précédent : le signal dont on ne sait rien
    // recevait l'affirmation de qualité la plus forte du produit.
    const message = buildSignalMessage(signal("moteur_inexistant") as any);
    expect(message).not.toMatch(/Haute Confiance/i);
    expect(message).toContain("BTC/USDT");
  });
});

describe("Le repli de contexte ne décrit pas la stratégie désactivée", () => {
  it("aucun signal n'est expliqué par EMA + RSI + ADX", () => {
    // C'est l'ancien moteur, mesuré PERDANT et désactivé le 03/08/2026. Il
    // servait de repli à tout moteur non répertorié — donc à tout moteur
    // ajouté sans passer par buildContext, ce qui est arrivé deux fois.
    for (const moteur of [...MOTEURS, "moteur_inexistant", ""]) {
      const message = buildSignalMessage(signal(moteur) as any);
      expect(message, `moteur ${moteur || "(vide)"}`).not.toMatch(/EMA \+ RSI \+ ADX/i);
    }
  });
});
