/**
 * Flux de paiement Monero — logique identique au module 2 (bot Node), voir
 * les commentaires détaillés là-bas sur la limite fondamentale : sans
 * monero-wallet-rpc (+ ngrok si distant), aucun explorateur public ne peut
 * prouver qu'une sous-adresse a reçu un paiement précis (propriété même de
 * la confidentialité de Monero, pas un manque de code).
 */

import { Env } from "../env";
import { digestAuthFetch } from "./httpDigestClient";
import { usdToCoinAmount } from "./priceConversion";
import { PaidPlan } from "./plans";

const ATOMIC_UNITS_PER_XMR = 1e12;
const AMOUNT_TOLERANCE = 0.97;

async function moneroRpcCall<T>(env: Env, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!env.MONERO_WALLET_RPC_URL) {
    throw new Error(
      "MONERO_WALLET_RPC_URL non configuré : lance monero-wallet-rpc (+ ngrok si nécessaire) et " +
      "ajoute son URL via `wrangler secret put MONERO_WALLET_RPC_URL` pour activer les paiements Monero."
    );
  }

  const body = JSON.stringify({ jsonrpc: "2.0", id: "0", method, params });
  const res = env.MONERO_WALLET_RPC_USER
    ? await digestAuthFetch(env.MONERO_WALLET_RPC_URL, {
        method: "POST",
        body,
        username: env.MONERO_WALLET_RPC_USER,
        password: env.MONERO_WALLET_RPC_PASSWORD || "",
      })
    : await fetch(env.MONERO_WALLET_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

  if (!res.ok) throw new Error(`monero-wallet-rpc a répondu ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`monero-wallet-rpc: ${json.error.message}`);
  return json.result as T;
}

export async function isWalletRpcAvailable(env: Env): Promise<boolean> {
  try {
    await moneroRpcCall(env, "get_version");
    return true;
  } catch {
    return false;
  }
}

export interface MoneroInvoice {
  address: string;
  addressIndex: number;
  amountXmr: number;
}

export async function createMoneroInvoice(env: Env, telegramId: number, plan: PaidPlan, amountUsd: number): Promise<MoneroInvoice> {
  const amountXmr = await usdToCoinAmount(amountUsd, "monero");
  const created = await moneroRpcCall<{ address: string; address_index: number }>(env, "create_address", {
    account_index: 0,
    label: `tg${telegramId}-plan${plan}-${Date.now()}`,
  });
  return { address: created.address, addressIndex: created.address_index, amountXmr };
}

interface MoneroTransfer {
  amount: number;
  confirmations: number;
  subaddr_index: { major: number; minor: number };
}

export async function checkMoneroPayment(env: Env, addressIndex: number, amountXmrExpected: number): Promise<boolean> {
  const result = await moneroRpcCall<{ in?: MoneroTransfer[] }>(env, "get_transfers", {
    in: true,
    subaddr_indices: [addressIndex],
  });

  const minConfirmations = Number(env.MONERO_MIN_CONFIRMATIONS || "10");
  const confirmed = (result.in || []).filter(
    (t) => t.confirmations >= minConfirmations && t.subaddr_index.minor === addressIndex
  );
  const totalReceivedXmr = confirmed.reduce((sum, t) => sum + t.amount, 0) / ATOMIC_UNITS_PER_XMR;

  return totalReceivedXmr >= amountXmrExpected * AMOUNT_TOLERANCE;
}
