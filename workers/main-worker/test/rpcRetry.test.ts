import { describe, it, expect, vi, afterEach } from "vitest";
import { getBlockNumber } from "../src/blockchain/rpc";
import { getCurrentPrices } from "../src/market/binancePrices";

function jsonRpcResult(result: unknown) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    headers: { "Content-Type": "application/json" },
  });
}

describe("blockchain/rpc.ts — retry (Bloc 8)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("réessaie après une erreur HTTP transitoire (429/5xx) et réussit", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) return new Response("rate limited", { status: 429 });
        return jsonRpcResult("0x64");
      })
    );

    const blockNumber = await getBlockNumber({ url: "https://fake-rpc.test" });
    expect(blockNumber).toBe(100);
    expect(attempts).toBe(3);
  });

  it("abandonne après le nombre maximal de tentatives", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        return new Response("erreur serveur", { status: 500 });
      })
    );

    await expect(getBlockNumber({ url: "https://fake-rpc.test" })).rejects.toThrow();
    expect(attempts).toBe(3);
  });

  it("ne réessaie jamais une erreur JSON-RPC applicative (params invalides, etc.)", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "invalid params" } }), {
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    await expect(getBlockNumber({ url: "https://fake-rpc.test" })).rejects.toThrow("invalid params");
    expect(attempts).toBe(1);
  });
});

describe("market/binancePrices.ts — retry (Bloc 8)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("réessaie après un échec transitoire et réussit", async () => {
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        attempts += 1;
        if (attempts < 2) return new Response("erreur", { status: 500 });
        return new Response(JSON.stringify([{ symbol: "BTCUSDT", price: "100.00" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const prices = await getCurrentPrices(["BTCUSDT"]);
    expect(prices.BTCUSDT).toBe(100);
    expect(attempts).toBe(2);
  });
});
