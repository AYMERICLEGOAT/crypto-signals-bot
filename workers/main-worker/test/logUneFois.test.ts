import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  journaliserErreurUneFois,
  signalerRetablissement,
  reinitialiserJournalUneFois,
  INTERVALLE_RAPPEL_MS,
} from "../src/utils/logUneFois";

/**
 * pollPayments tourne toutes les cinq minutes. Quand la cause est permanente —
 * le RPC Polygon public élague son historique, donc eth_getLogs sur un bloc
 * ancien échoue indéfiniment — l'ancien code produisait 288 lignes identiques
 * par jour, au milieu desquelles une vraie panne devenait invisible.
 */

let erreurs: string[];
let infos: string[];

beforeEach(() => {
  reinitialiserJournalUneFois();
  erreurs = [];
  infos = [];
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void erreurs.push(a.join(" ")));
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void infos.push(a.join(" ")));
});

afterEach(() => vi.restoreAllMocks());

const PANNE = new Error("RPC Polygon (eth_getLogs): History has been pruned for this block.");
const T0 = 1_000_000_000_000;

describe("Une panne permanente ne noie plus le journal", () => {
  it("journalise la première occurrence", () => {
    journaliserErreurUneFois("usdt-offchain", PANNE, T0);
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toContain("History has been pruned");
  });

  it("tait les répétitions d'une même cause", () => {
    // Une journée entière de cron toutes les 5 min : 288 appels.
    for (let i = 0; i < 288; i++) {
      journaliserErreurUneFois("usdt-offchain", PANNE, T0 + i * 5 * 60_000);
    }
    // 288 appels sur 24 h : 1 initiale + 3 rappels (6 h, 12 h, 18 h).
    expect(erreurs.length).toBeLessThanOrEqual(4);
    expect(erreurs.length).toBeGreaterThan(0);
  });

  it("MAIS ne fait jamais disparaître une panne qui dure", () => {
    // Une déduplication pure rendrait un problème permanent invisible pour
    // toujours — exactement le « vert qui n'a rien fait » corrigé ailleurs.
    journaliserErreurUneFois("usdt-offchain", PANNE, T0);
    journaliserErreurUneFois("usdt-offchain", PANNE, T0 + INTERVALLE_RAPPEL_MS);
    expect(erreurs).toHaveLength(2);
    expect(erreurs[1]).toMatch(/Toujours en échec depuis/);
    expect(erreurs[1]).toContain("History has been pruned");
  });
});

describe("Ce qui doit rester visible", () => {
  it("une cause DIFFÉRENTE est journalisée immédiatement", () => {
    // Passer d'un « historique élagué » à un « 401 non autorisé » est une
    // information, pas une répétition.
    journaliserErreurUneFois("usdt-offchain", PANNE, T0);
    journaliserErreurUneFois("usdt-offchain", new Error("401 non autorisé"), T0 + 60_000);
    expect(erreurs).toHaveLength(2);
    expect(erreurs[1]).toContain("401");
  });

  it("deux collecteurs différents ne se masquent pas l'un l'autre", () => {
    journaliserErreurUneFois("usdt-offchain", PANNE, T0);
    journaliserErreurUneFois("monero", PANNE, T0);
    expect(erreurs).toHaveLength(2);
  });

  it("le rétablissement est journalisé", () => {
    // Sans cette ligne, on ne saurait jamais qu'une panne s'est terminée.
    journaliserErreurUneFois("usdt-offchain", PANNE, T0);
    signalerRetablissement("usdt-offchain", T0 + 2 * 3_600_000);
    expect(infos).toHaveLength(1);
    expect(infos[0]).toMatch(/Rétabli après 2 h/);
  });

  it("un rétablissement sans panne en cours ne dit rien", () => {
    // Le cas normal : 288 succès par jour ne doivent produire aucune ligne.
    signalerRetablissement("usdt-offchain", T0);
    expect(infos).toHaveLength(0);
  });

  it("après rétablissement, une nouvelle panne est de nouveau journalisée", () => {
    journaliserErreurUneFois("usdt-offchain", PANNE, T0);
    signalerRetablissement("usdt-offchain", T0 + 60_000);
    journaliserErreurUneFois("usdt-offchain", PANNE, T0 + 120_000);
    expect(erreurs).toHaveLength(2);
  });
});
