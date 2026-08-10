import { describe, it, expect, vi, afterEach } from "vitest";
import { catchUpUsdtTransfers } from "../src/blockchain/usdtTransfers";

/**
 * LE SCAN DES PAIEMENTS CASSAIT AU MOMENT OÙ IL DEVENAIT SAIN.
 *
 * Observé en production le 10/08/2026, cron des cinq minutes :
 *
 *   (error) [usdt-offchain] RPC Polygon (eth_getLogs): invalid block range params
 *
 * `eth_blockNumber` et `eth_getLogs` sont deux appels distincts qui peuvent
 * atterrir sur deux machines différentes : le nœud principal est un point
 * d'entrée réparti, le repli un fournisseur entièrement distinct. Le scan
 * demandait donc des logs jusqu'à une tête obtenue ailleurs — c'est-à-dire des
 * blocs qui n'existent pas encore pour le nœud interrogé.
 *
 * Reproduit à l'identique contre les vrais nœuds : tête à 91 785 584, requête
 * jusqu'à 91 785 828 → « invalid block range params » ; jusqu'à 91 785 428 →
 * 454 logs rendus.
 *
 * C'est une erreur JSON-RPC APPLICATIVE : par conception elle n'est ni
 * rejouée, ni basculée sur le nœud de secours (voir rpc.ts, et c'est le bon
 * choix — une requête malformée échouera partout). Elle remonte donc sèchement
 * et le scan reste bloqué sur la même position, cycle après cycle.
 *
 * Le calendrier de ce défaut est le vrai piège. Tant que le scanner avait du
 * retard, `toBlock` tombait loin derrière la tête et rien ne se voyait. Il ne
 * casse qu'une fois le rattrapage terminé — quand le système atteint enfin son
 * régime normal. Un bug qui attend la guérison pour frapper.
 *
 * La marge protège aussi d'une réorganisation : créditer un abonnement sur un
 * transfert vu à la tête de chaîne, c'est risquer de l'activer pour un
 * paiement annulé. Le Litecoin et le Monero attendaient déjà leurs
 * confirmations ; ce chemin — le plus recommandé par /subscribe — n'en
 * attendait aucune.
 */

const TETE = 91_785_584;

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  POLYGON_RPC_URL: "https://noeud.test",
  PAYMENT_ADDRESS_USDT: "0x71367B5f4519700a63c2564b754cF9593170000a",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
  TELEGRAM_BOT_TOKEN: "t",
} as never;

const db = { url: "https://fake.test", key: "k" };

interface Options {
  /** Dernière position enregistrée en base. */
  dernierBloc: number;
  /**
   * Hauteur RÉELLE du nœud qui sert eth_getLogs. Plus basse que la tête rendue
   * par eth_blockNumber : c'est exactement l'écart observé en production.
   */
  hauteurGetLogs?: number;
}

function stub(opts: Options) {
  const plages: { from: number; to: number }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("noeud.test")) {
        const corps = JSON.parse((init?.body as string) ?? "{}");
        if (corps.method === "eth_blockNumber") {
          return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" + TETE.toString(16) });
        }
        const p = corps.params[0];
        const from = parseInt(p.fromBlock, 16);
        const to = parseInt(p.toBlock, 16);
        plages.push({ from, to });
        if (to > (opts.hauteurGetLogs ?? TETE)) {
          // Le message EXACT rendu par le nœud en production.
          return jsonResponse({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "invalid block range params" } });
        }
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: [] });
      }
      if (url.includes("chain_state")) {
        return jsonResponse([{ key: "last_processed_block_usdt_transfers", value: String(opts.dernierBloc) }]);
      }
      return jsonResponse([]);
    })
  );

  return { plages };
}

describe("Le scan USDT ne lit jamais la tête de chaîne", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("laisse une marge sous la tête rendue par eth_blockNumber", async () => {
    // La propriété qui compte. Sans elle, toBlock valait exactement la tête.
    const s = stub({ dernierBloc: TETE - 300 });
    await catchUpUsdtTransfers(env, db);
    expect(s.plages.length).toBeGreaterThan(0);
    for (const p of s.plages) {
      expect(p.to, `plage jusqu'a ${p.to} alors que la tete est ${TETE}`).toBeLessThan(TETE);
    }
  });

  it("survit à un nœud eth_getLogs en retard de quelques blocs", async () => {
    // Le scénario réel : deux machines, deux hauteurs. Le scan doit avancer
    // sans erreur au lieu de rester bloqué sur la même position.
    const s = stub({ dernierBloc: TETE - 300, hauteurGetLogs: TETE - 12 });
    await expect(catchUpUsdtTransfers(env, db)).resolves.toBeInstanceOf(Array);
    expect(s.plages.length).toBeGreaterThan(0);
  });

  it("ne demande rien du tout quand tout est déjà scanné", async () => {
    // Régime établi : la position est à jour, il n'y a que la marge devant.
    // Interroger quand même produirait une plage inversée.
    const s = stub({ dernierBloc: TETE - 5 });
    await catchUpUsdtTransfers(env, db);
    expect(s.plages).toHaveLength(0);
  });

  it("avance quand même : la marge ne fige pas le scan", async () => {
    // Une marge mal posée transformerait la protection en blocage permanent.
    const s = stub({ dernierBloc: TETE - 300 });
    await catchUpUsdtTransfers(env, db);
    expect(s.plages[0].from).toBe(TETE - 299);
    expect(s.plages[0].to).toBeGreaterThan(s.plages[0].from);
  });
});
