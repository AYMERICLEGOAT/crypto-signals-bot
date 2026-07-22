import { describe, it, expect, vi, afterEach } from "vitest";
import { buildAndSignLegacyTx } from "../src/blockchain/tx";

const REF_PRIVATE_KEY = "0x9d92b00f863ccfe095160dc2df15ddb17f96101f8805902b4620da7790e3039d";

// Transaction "golden value" : mêmes paramètres (nonce=5, gasPrice=30 gwei,
// gasLimit=100000, to=OWNER du contrat, value=0, chainId=137/Polygon) déjà
// signés hors de ce projet et vérifiés indépendamment avec
// `ethers.Transaction.from(rawTx)` — qui décode exactement les mêmes champs
// et recouvre la même adresse depuis la signature (voir conversation).
const EXPECTED_RAW_TX =
  "0xf867058506fc23ac00830186a09471367b5f4519700a63c2564b754cf959317e1f618080820136a0a3f9322cc14deb9c9c2254834c244aaf65c98fea402ad29772c63121faa9acc3a04017f5187033791c559e9a3283886d35f0e12d4f81cf86d164b2bd1458d78bc0";

function jsonRpcResult(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildAndSignLegacyTx", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reproduit exactement la transaction de référence pour les mêmes paramètres", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as { method: string };
        switch (body.method) {
          case "eth_getTransactionCount":
            return jsonRpcResult("0x5"); // nonce = 5
          case "eth_gasPrice":
            return jsonRpcResult("0x6fc23ac00"); // 30 000 000 000 (30 gwei)
          case "eth_chainId":
            return jsonRpcResult("0x89"); // 137 = Polygon
          default:
            throw new Error(`Appel RPC inattendu dans ce test: ${body.method}`);
        }
      })
    );

    const rawTx = await buildAndSignLegacyTx(
      { url: "https://fake-rpc.test" },
      REF_PRIVATE_KEY,
      { to: "0x71367B5f4519700a63c2564b754cF959317E1f61", data: "0x", value: 0n, gasLimit: 100_000n }
    );

    expect(rawTx).toBe(EXPECTED_RAW_TX);
  });
});
