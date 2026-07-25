import { describe, it, expect, vi, afterEach } from "vitest";
import { catchUpUsdtTransfers } from "../src/blockchain/usdtTransfers";
import { TRANSFER_TOPIC0, encodeAddressArg } from "../src/blockchain/abi";

const PAYMENT_ADDRESS = "0x71367B5f4519700a63c2564b754cF959317E1f61";
// Générée avec .padEnd plutôt que tapée à la main : une frappe manuelle de 40
// caractères hex identiques est une source d'erreur classique (déjà vue dans
// ce projet) — mieux vaut construire la longueur exacte programmatiquement.
const SENDER_ADDRESS = "0x" + "ab".repeat(20);

function jsonRpcResult(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("catchUpUsdtTransfers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("détecte un transfert USDT entrant et décode expéditeur + montant", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("https://fake-rpc.test")) {
          const body = JSON.parse(init!.body as string) as { method: string };
          if (body.method === "eth_blockNumber") return jsonRpcResult("0x64"); // bloc 100
          if (body.method === "eth_getLogs") {
            const amountHex = (25_000_000n).toString(16).padStart(64, "0"); // 25 USDT, 6 décimales
            return jsonRpcResult([
              {
                address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
                topics: [TRANSFER_TOPIC0, "0x" + encodeAddressArg(SENDER_ADDRESS), "0x" + encodeAddressArg(PAYMENT_ADDRESS)],
                data: "0x" + amountHex,
                blockNumber: "0x64",
                transactionHash: "0xdeadbeef",
              },
            ]);
          }
          throw new Error(`Appel RPC inattendu: ${body.method}`);
        }

        if (url.startsWith("https://fake-supabase.test")) {
          if (url.includes("payment_cache") && (!init || init.method === undefined)) {
            return jsonResponse([]); // pas encore vu ce tx_hash
          }
          if (url.includes("payment_cache") && init?.method === "POST") {
            return jsonResponse([{ tx_hash: "0xdeadbeef", verified_result: true }]);
          }
          if (!init || init.method === undefined) {
            return jsonResponse([]); // getLastProcessedBlock: aucun checkpoint existant
          }
          if (init.method === "POST") {
            return jsonResponse([{ key: "last_processed_block_usdt_transfers", value: "100" }]);
          }
        }

        throw new Error(`URL inattendue dans ce test: ${url}`);
      })
    );

    const env = {
      PAYMENT_ADDRESS_USDT: PAYMENT_ADDRESS,
      POLYGON_RPC_URL: "https://fake-rpc.test",
    } as any;
    const db = { url: "https://fake-supabase.test", key: "fake-key" };

    const events = await catchUpUsdtTransfers(env, db);

    expect(events).toHaveLength(1);
    expect(events[0].from.toLowerCase()).toBe(SENDER_ADDRESS.toLowerCase());
    expect(events[0].amount).toBe(25);
  });

  it("ignore un transfert dont le tx_hash est déjà dans payment_cache (Bloc 8, idempotence)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith("https://fake-rpc.test")) {
          const body = JSON.parse(init!.body as string) as { method: string };
          if (body.method === "eth_blockNumber") return jsonRpcResult("0x64");
          if (body.method === "eth_getLogs") {
            const amountHex = (25_000_000n).toString(16).padStart(64, "0");
            return jsonRpcResult([
              {
                address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
                topics: [TRANSFER_TOPIC0, "0x" + encodeAddressArg(SENDER_ADDRESS), "0x" + encodeAddressArg(PAYMENT_ADDRESS)],
                data: "0x" + amountHex,
                blockNumber: "0x64",
                transactionHash: "0xalreadyseen",
              },
            ]);
          }
          throw new Error(`Appel RPC inattendu: ${body.method}`);
        }

        if (url.startsWith("https://fake-supabase.test")) {
          if (url.includes("payment_cache")) return jsonResponse([{ tx_hash: "0xalreadyseen", verified_result: true }]); // déjà vu
          if (!init || init.method === undefined) return jsonResponse([]);
          if (init.method === "POST") return jsonResponse([{ key: "last_processed_block_usdt_transfers", value: "100" }]);
        }

        throw new Error(`URL inattendue dans ce test: ${url}`);
      })
    );

    const env = { PAYMENT_ADDRESS_USDT: PAYMENT_ADDRESS, POLYGON_RPC_URL: "https://fake-rpc.test" } as any;
    const db = { url: "https://fake-supabase.test", key: "fake-key" };

    const events = await catchUpUsdtTransfers(env, db);
    expect(events).toEqual([]);
  });

  it("ne fait rien si PAYMENT_ADDRESS_USDT n'est pas configuré", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const env = { PAYMENT_ADDRESS_USDT: undefined, POLYGON_RPC_URL: "https://fake-rpc.test" } as any;
    const db = { url: "https://fake-supabase.test", key: "fake-key" };

    const events = await catchUpUsdtTransfers(env, db);

    expect(events).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
