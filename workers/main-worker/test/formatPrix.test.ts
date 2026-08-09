import { describe, it, expect } from "vitest";
import { prix, buildSignalMessage } from "../src/signalFormat";

/**
 * Le canal public a réellement publié ceci le 09/08/2026 :
 *
 *   🛑 Stop-Loss : 2.06437058
 *   🥇 TP1 : 2.33562942 (+6,2 % (ratio 1:1.0))
 *
 * Sur un actif à 2,20 $. Personne ne passe un ordre à huit décimales, et
 * « 1:1.0 » mêle un point décimal anglais à un texte qui écrit « +6,2 % » deux
 * caractères plus loin. Sur un produit dont l'argument central est la rigueur
 * de la mesure, c'est le détail qui le fait passer pour amateur.
 */

describe("Arrondi des prix", () => {
  it("réduit un niveau calculé à ce qu'un humain peut saisir", () => {
    expect(prix(2.06437058)).toBe("2.0644");
    expect(prix(2.33562942)).toBe("2.3356");
  });

  it("s'adapte à l'ordre de grandeur", () => {
    // L'univers va du BTC à 65 000 $ au HMSTR à 0,0001977 $ : une précision
    // fixe rendrait l'un illisible ou l'autre ridicule.
    expect(prix(64923.19)).toBe("64923.19");
    expect(prix(592.57)).toBe("592.57");
    expect(prix(2.2)).toBe("2.2");
    expect(prix(0.01764)).toBe("0.01764");
    expect(prix(0.0001977)).toBe("0.0001977");
  });

  it("ne mange jamais les zéros d'un entier", () => {
    // Le piège du retrait naïf des zéros : "100" deviendrait "1".
    expect(prix(100)).toBe("100");
    expect(prix(1000)).toBe("1000");
    expect(prix(64900)).toBe("64900");
  });

  it("garde le POINT décimal, pas la virgule", () => {
    // Ces nombres sont faits pour être recopiés dans une plateforme d'échange,
    // qui attend un point. Une virgule obligerait à convertir à la main, au
    // moment précis où une erreur de saisie coûte de l'argent — contrairement
    // aux pourcentages, qui restent à la française partout.
    expect(prix(2.0644)).not.toContain(",");
  });

  it("ne casse pas sur une valeur non numérique", () => {
    expect(() => prix("n/a" as unknown as number)).not.toThrow();
  });
});

describe("Le message de signal, tel qu'il part réellement", () => {
  const signal = {
    type: "BUY" as const,
    pair: "ICP/USDT",
    entry_price: 2.2,
    stop_loss: 2.06437058,
    take_profit: 2.47125884,
    tp1_price: 2.33562942,
    tp2_price: 2.47125884,
    tp3_price: 2.60688826,
    created_at: "2026-08-09T02:21:09Z",
    engine: "momentum_4h",
    hold_until: "2026-08-12T02:21:09Z",
  };

  it("n'affiche plus aucun prix à rallonge", () => {
    const texte = buildSignalMessage(signal as never);
    expect(texte).not.toContain("2.06437058");
    expect(texte).not.toContain("2.33562942");
    expect(texte).toContain("2.0644");
  });

  it("écrit un ratio entier sans décimale anglaise", () => {
    // Le stop est à 6,2 % et TP1 à +6,2 % : le ratio vaut exactement 1.
    const texte = buildSignalMessage(signal as never);
    expect(texte).toContain("ratio 1:1)");
    expect(texte).not.toContain("1:1.0");
  });

  it("rapporte la taille de position au capital TOTAL", () => {
    // La formulation précédente — « 32 % de ton capital alloué à ce trade » —
    // était circulaire, et fausse : 32 % est une part du capital total.
    const texte = buildSignalMessage(signal as never);
    expect(texte).toContain("capital TOTAL");
    expect(texte).not.toContain("capital alloué à ce trade");
  });
});
