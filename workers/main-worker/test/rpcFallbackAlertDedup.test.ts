import { describe, it, expect, vi, afterEach } from "vitest";
import { buildPolygonRpcConfig, getBlockNumber } from "../src/blockchain/rpc";

/**
 * UNE BASCULE RÉUSSIE NE DOIT PAS ALERTER.
 *
 * Ce fichier testait l'inverse : il vérifiait qu'une alerte partait au premier
 * échec du nœud principal, puis toutes les heures tant que la panne durait. La
 * déduplication horaire avait été ajoutée parce que l'alerte partait à chaque
 * cycle de cinq minutes — elle traitait le symptôme.
 *
 * Le vrai défaut était ailleurs : cette alerte annonçait un SUCCÈS. « Bascule
 * sur le nœud de secours » signifie que la redondance a joué son rôle. Elle
 * n'appelait aucune action — les nœuds publics limitent les IP Cloudflare de
 * façon intermittente, le propriétaire n'y peut rien — et elle usait le canal
 * d'alerte. Le propriétaire en a reçu à 01:20 puis 11:20 le même jour, pour un
 * système qui fonctionnait.
 *
 * C'est le pire dégât possible sur un canal d'alerte : une alerte non
 * actionnable répétée apprend à les ignorer toutes. Le jour où un vrai
 * problème de paiement arrive, il tombe dans un canal que plus personne ne lit.
 *
 * Ce qui mérite une alerte est l'échec des DEUX nœuds — c'est-à-dire l'arrêt
 * réel de la détection des paiements. Ce cas remonte par l'erreur du cron.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "t",
  ADMIN_TELEGRAM_ID: "8647576528",
  POLYGON_RPC_URL: "https://primaire.test",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
} as never;

interface Options {
  /** Le nœud de secours répond-il ? */
  secoursOk?: boolean;
}

function stub(opts: Options = {}) {
  const messagesTelegram: string[] = [];
  let bascules = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        const b = JSON.parse((init?.body as string) ?? "{}");
        if (b.text) messagesTelegram.push(String(b.text));
        return jsonResponse({ ok: true, result: {} });
      }
      // Le primaire échoue toujours : c'est le scénario observé en production
      // depuis Cloudflare, dont les IP sont limitées par le nœud public.
      if (url.includes("primaire.test")) {
        return new Response("rate limited", { status: 429 });
      }
      if (url.includes("tenderly")) {
        bascules++;
        if (opts.secoursOk === false) return new Response("down", { status: 503 });
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x5784d79" });
      }
      return jsonResponse([]);
    })
  );

  return { messagesTelegram, bascules: () => bascules };
}

describe("Bascule vers le nœud de secours", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("N'ENVOIE AUCUNE alerte quand le secours prend le relais", async () => {
    // La propriété qui compte. Le système a fonctionné : il n'y a rien à
    // signaler, et surtout rien à faire.
    const s = stub();
    await getBlockNumber(buildPolygonRpcConfig(env));
    expect(s.messagesTelegram, "une alerte est partie pour un succès").toHaveLength(0);
  });

  it("bascule quand même réellement — le silence n'est pas de l'inaction", async () => {
    const s = stub();
    const bloc = await getBlockNumber(buildPolygonRpcConfig(env));
    expect(s.bascules()).toBeGreaterThan(0);
    expect(bloc).toBeGreaterThan(0);
  });

  it("n'alerte pas davantage sur des bascules répétées", async () => {
    // C'est ici que naissait le spam : un cycle toutes les cinq minutes, une
    // panne intermittente qui dure, et le canal se remplit.
    // Quatre passages suffisent : l'ancienne alerte partait DES LE PREMIER,
    // puis a chaque heure. Douze iterations feraient depasser le delai du test
    // a cause des trois essais avec attente exponentielle avant chaque bascule.
    const s = stub();
    for (let i = 0; i < 4; i++) {
      await getBlockNumber(buildPolygonRpcConfig(env));
    }
    expect(s.bascules()).toBe(4);
    expect(s.messagesTelegram).toHaveLength(0);
  }, 20000);
});

describe("Quand les DEUX nœuds tombent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("l'erreur remonte à l'appelant au lieu d'être avalée", async () => {
    // C'est le seul cas qui mérite d'être signalé : la détection des paiements
    // s'arrête vraiment. Il remonte par l'erreur du cron, journalisée une fois
    // par panne avec rappel toutes les six heures (voir utils/logUneFois).
    stub({ secoursOk: false });
    await expect(getBlockNumber(buildPolygonRpcConfig(env))).rejects.toThrow();
  });
});
