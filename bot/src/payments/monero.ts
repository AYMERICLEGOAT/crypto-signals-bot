/**
 * Flux de paiement Monero.
 *
 * ⚠️ Limite technique importante (propriété fondamentale de Monero) : seul
 * un wallet possédant la clé de vue (view key) — donc `monero-wallet-rpc`,
 * local ou tunnelé via ngrok — peut déterminer avec certitude si UNE
 * sous-adresse précise a reçu UN montant précis. Un explorateur public
 * (xmrchain.net et équivalents) ne peut PAS faire cette vérification sans
 * cette clé : c'est précisément ce qui rend Monero privé. Il n'existe donc
 * pas de "fallback public" fiable équivalent à celui utilisé pour Litecoin.
 *
 * En conséquence : tant que `monero-wallet-rpc` (+ ngrok si le bot tourne
 * à distance) n'est pas joignable, les paiements Monero ne peuvent pas être
 * confirmés automatiquement. Le poller (voir index.ts) réessaie simplement
 * au cycle suivant et logue un avertissement — voir le README pour le détail.
 */

import { config } from "../config";
import { digestAuthFetch } from "./httpDigestClient";
import { usdToCoinAmount } from "./priceConversion";

const ATOMIC_UNITS_PER_XMR = 1e12;
const AMOUNT_TOLERANCE = 0.97; // tolère 3% de dérive de cours entre facture et paiement

async function moneroRpcCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!config.monero.walletRpcUrl) {
    throw new Error(
      "MONERO_WALLET_RPC_URL non configuré : lance monero-wallet-rpc (et ngrok si le bot " +
      "tourne à distance), puis renseigne l'URL dans .env pour activer les paiements Monero."
    );
  }

  const body = JSON.stringify({ jsonrpc: "2.0", id: "0", method, params });
  const res = config.monero.walletRpcUser
    ? await digestAuthFetch(config.monero.walletRpcUrl, {
        method: "POST",
        body,
        username: config.monero.walletRpcUser,
        password: config.monero.walletRpcPassword,
      })
    : await fetch(config.monero.walletRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });

  if (!res.ok) throw new Error(`monero-wallet-rpc a répondu ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`monero-wallet-rpc: ${json.error.message}`);
  return json.result as T;
}

export async function isWalletRpcAvailable(): Promise<boolean> {
  try {
    await moneroRpcCall("get_version");
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

/** Crée une sous-adresse dédiée, jamais réutilisée, pour cette facture précise. */
export async function createMoneroInvoice(telegramId: number, plan: 1 | 2, amountUsd: number): Promise<MoneroInvoice> {
  const amountXmr = await usdToCoinAmount(amountUsd, "monero");
  const created = await moneroRpcCall<{ address: string; address_index: number }>("create_address", {
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

/**
 * Vérifie si la sous-adresse `addressIndex` a reçu au moins `amountXmrExpected`
 * (tolérance 3%) avec au moins MONERO_MIN_CONFIRMATIONS confirmations.
 * Lance une erreur si monero-wallet-rpc est injoignable (voir note en tête de fichier).
 */
export async function checkMoneroPayment(addressIndex: number, amountXmrExpected: number): Promise<boolean> {
  const result = await moneroRpcCall<{ in?: MoneroTransfer[] }>("get_transfers", {
    in: true,
    subaddr_indices: [addressIndex],
  });

  const confirmed = (result.in || []).filter(
    (t) => t.confirmations >= config.monero.minConfirmations && t.subaddr_index.minor === addressIndex
  );
  const totalReceivedXmr = confirmed.reduce((sum, t) => sum + t.amount, 0) / ATOMIC_UNITS_PER_XMR;

  return totalReceivedXmr >= amountXmrExpected * AMOUNT_TOLERANCE;
}
