import { describe, it, expect, vi, afterEach } from "vitest";
import { catchUpUsdtTransfers, MAX_CHUNKS_PER_RUN } from "../src/blockchain/usdtTransfers";

/**
 * AUCUN PAIEMENT USDT N'AURAIT JAMAIS ÉTÉ DÉTECTÉ.
 *
 * Le premier scan repartait 300 000 blocs en arrière. Les nœuds Polygon
 * publics élaguent leur historique à cette profondeur : `eth_getLogs` répondait
 * « History has been pruned for this block », l'erreur remontait avant
 * `setLastProcessedBlock`, donc aucune position n'était jamais enregistrée — et
 * le cycle suivant repartait du même bloc introuvable. Boucle infinie et
 * silencieuse, sur le moyen de paiement que /subscribe RECOMMANDE.
 *
 * Deux propriétés sont verrouillées ici, et elles s'opposent volontairement :
 *
 *   - un élagage fait AVANCER le scan (ces blocs sont perdus pour toujours,
 *     s'obstiner ne les ramène pas et bloque tout) ;
 *   - toute autre erreur fait ÉCHOUER le cycle (elle est transitoire, et
 *     avancer sauterait des blocs pouvant contenir un vrai paiement — un
 *     abonné aurait payé sans jamais être activé).
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  PAYMENT_ADDRESS_USDT: "0x71367B5f4519700a63c2564b754cF9593170000a",
  POLYGON_RPC_URL: "https://rpc.test",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
} as never;

const db = { url: "https://fake.test", key: "k" } as never;
const BLOC_COURANT = 91_770_254;

interface Options {
  /** Erreur renvoyée par eth_getLogs, ou null pour un succès. */
  erreurLogs?: string | null;
  /** Position déjà enregistrée, ou null pour un premier scan. */
  positionEnregistree?: number | null;
}

function stub(opts: Options = {}) {
  const positionsEcrites: number[] = [];
  const plagesDemandees: { from: number; to: number }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("rpc.test")) {
        const corps = JSON.parse(init!.body as string);
        if (corps.method === "eth_blockNumber") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" + BLOC_COURANT.toString(16) });
        }
        if (corps.method === "eth_getLogs") {
          const p = corps.params[0];
          plagesDemandees.push({ from: parseInt(p.fromBlock, 16), to: parseInt(p.toBlock, 16) });
          if (opts.erreurLogs) {
            return jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: opts.erreurLogs } });
          }
          return jsonResponse({ jsonrpc: "2.0", id: 1, result: [] });
        }
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: null });
      }
      if (url.includes("chain_state")) {
        if (init?.method === "POST" || init?.method === "PATCH") {
          const corps = JSON.parse(init.body as string);
          const v = Array.isArray(corps) ? corps[0]?.value : corps?.value;
          if (v !== undefined) positionsEcrites.push(Number(v));
          return jsonResponse([]);
        }
        return jsonResponse(
          opts.positionEnregistree == null ? [] : [{ key: "x", value: String(opts.positionEnregistree) }]
        );
      }
      return jsonResponse([]);
    })
  );

  return { positionsEcrites, plagesDemandees };
}

describe("Le premier scan reste dans ce que le nœud sert encore", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne remonte jamais 300 000 blocs en arrière", async () => {
    // La valeur exacte qui a tout cassé. Mesuré le 10/08/2026 : le nœud public
    // répond à −50 000 et échoue à −300 000.
    const { plagesDemandees } = stub();
    await catchUpUsdtTransfers(env, db);
    expect(plagesDemandees.length).toBeGreaterThan(0);
    const plusAncien = Math.min(...plagesDemandees.map((p) => p.from));
    expect(BLOC_COURANT - plusAncien).toBeLessThanOrEqual(50_000);
  });

  it("reprend à la position enregistrée quand elle existe", async () => {
    const { plagesDemandees } = stub({ positionEnregistree: BLOC_COURANT - 100 });
    await catchUpUsdtTransfers(env, db);
    expect(Math.min(...plagesDemandees.map((p) => p.from))).toBe(BLOC_COURANT - 99);
  });
});

describe("Élagage : avancer, parce que ces blocs sont perdus", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("enregistre quand même une position au lieu de rester bloqué", async () => {
    // C'EST LE CŒUR DU BUG : sans position enregistrée, chaque cycle repartait
    // du même bloc introuvable, indéfiniment. Ce qui compte est que le scan
    // AVANCE, pas qu'il termine — le rattrapage est volontairement étalé sur
    // plusieurs passages pour ne pas épuiser le budget de sous-requêtes.
    const { positionsEcrites } = stub({ erreurLogs: "History has been pruned for this block." });
    await catchUpUsdtTransfers(env, db);
    expect(positionsEcrites.length, "aucune position enregistrée : le scan reste bloqué").toBeGreaterThan(0);
    const depart = BLOC_COURANT - 40_000;
    expect(Math.max(...positionsEcrites), "la position n'a pas progressé").toBeGreaterThan(depart);
  });

  it("ne lève pas : le cron doit continuer", async () => {
    stub({ erreurLogs: "History has been pruned for this block." });
    await expect(catchUpUsdtTransfers(env, db)).resolves.toBeDefined();
  });
});

describe("Le rattrapage est borné par passage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne fait jamais plus de MAX_CHUNKS_PER_RUN appels en une invocation", async () => {
    // Sans cette borne, un retard de 40 000 blocs faisait vingt appels
    // eth_getLogs plus autant d'ecritures dans UNE invocation : le budget de
    // 50 sous-requetes du Worker etait epuise, et les taches suivantes de la
    // chaine mouraient avec. Observe en production le 10/08/2026, juste apres
    // avoir rendu ce scan fonctionnel.
    const { plagesDemandees } = stub();
    await catchUpUsdtTransfers(env, db);
    expect(plagesDemandees.length).toBeLessThanOrEqual(MAX_CHUNKS_PER_RUN);
  });

  it("reprend exactement la ou il s'etait arrete", async () => {
    // Chaque tranche traitee est enregistree : le passage suivant ne refait
    // aucun travail deja fait.
    const { positionsEcrites } = stub();
    await catchUpUsdtTransfers(env, db);
    const derniere = Math.max(...positionsEcrites);

    const suite = stub({ positionEnregistree: derniere });
    await catchUpUsdtTransfers(env, db);
    expect(Math.min(...suite.plagesDemandees.map((p) => p.from))).toBe(derniere + 1);
  });
});

describe("Erreur transitoire : NE PAS avancer, sous peine de rater un paiement", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("relance l'erreur au lieu de sauter des blocs", async () => {
    // Avancer ici sauterait des blocs pouvant contenir un vrai paiement :
    // l'abonné aurait payé sans jamais être activé. Le cycle suivant réessaie.
    stub({ erreurLogs: "rate limit exceeded" });
    await expect(catchUpUsdtTransfers(env, db)).rejects.toThrow();
  });

  it("n'enregistre AUCUNE position sur une erreur transitoire", async () => {
    const { positionsEcrites } = stub({ erreurLogs: "connection reset" });
    await catchUpUsdtTransfers(env, db).catch(() => {});
    expect(positionsEcrites).toHaveLength(0);
  });
});
