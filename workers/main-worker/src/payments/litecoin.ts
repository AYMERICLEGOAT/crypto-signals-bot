/**
 * Flux de paiement Litecoin. Contrairement au module 2 (bot Node), ce
 * Worker ne dérive AUCUNE adresse lui-même : bitcoinjs-lib/bip32 échouent
 * sous workerd (testé empiriquement — dépendances Node historiques
 * incompatibles, voir README). Les adresses sont pré-générées hors-ligne
 * avec l'outillage Node du module 2 et stockées dans un pool Supabase
 * (voir db/litecoinPool.ts et scripts/generate-litecoin-pool.ts côté bot/).
 */

import { Env } from "../env";
import { SupabaseConfig } from "../supabaseRest";
import { claimLitecoinAddress } from "../db/litecoinPool";
import { usdToCoinAmount } from "./priceConversion";

export interface LitecoinInvoice {
  address: string;
  hdIndex: number;
  amountLtc: number;
}

/** Retourne null si le pool d'adresses est épuisé (voir README pour le réapprovisionner). */
export async function createLitecoinInvoice(
  db: SupabaseConfig,
  telegramId: number,
  amountUsd: number
): Promise<LitecoinInvoice | null> {
  const claimed = await claimLitecoinAddress(db, telegramId);
  if (!claimed) return null;

  const amountLtc = await usdToCoinAmount(amountUsd, "litecoin");
  return { address: claimed.address, hdIndex: claimed.hd_index, amountLtc };
}

interface BlockchairAddressResponse {
  data: Record<string, { address: { balance: number }; transactions?: string[] }>;
}

interface BlockchairTransactionResponse {
  data: Record<string, { inputs: { recipient: string }[] }>;
}

export interface LitecoinPaymentCheck {
  paid: boolean;
  /**
   * Adresse d'où vient le paiement (anti-abus parrainage, voir
   * bot/referral.ts) : contrairement à Monero, Litecoin est une blockchain
   * transparente — l'expéditeur d'une transaction entrante est public,
   * on peut donc le comparer à celui du parrain comme pour USDT.
   */
  senderAddress: string | null;
}

async function fetchLitecoinSenderAddress(env: Env, txHash: string | undefined): Promise<string | null> {
  if (!txHash) return null;
  try {
    const keyParam = env.BLOCKCHAIR_API_KEY ? `?key=${env.BLOCKCHAIR_API_KEY}` : "";
    const res = await fetch(`https://api.blockchair.com/litecoin/dashboards/transaction/${txHash}${keyParam}`);
    if (!res.ok) return null;
    const json = (await res.json()) as BlockchairTransactionResponse;
    return json.data?.[txHash]?.inputs?.[0]?.recipient ?? null;
  } catch (err) {
    console.warn(`[litecoin] Échec de récupération de l'expéditeur pour ${txHash}:`, err);
    return null;
  }
}

export async function checkLitecoinPayment(env: Env, address: string, amountLtcExpected: number): Promise<LitecoinPaymentCheck> {
  const keyParam = env.BLOCKCHAIR_API_KEY ? `&key=${env.BLOCKCHAIR_API_KEY}` : "";
  // limit=1 (au lieu de 0) : on a besoin du hash de la transaction la plus
  // récente pour en retrouver l'expéditeur ci-dessous.
  const url = `https://api.blockchair.com/litecoin/dashboards/address/${address}?limit=1${keyParam}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blockchair a répondu ${res.status}`);
  const json = (await res.json()) as BlockchairAddressResponse;

  const entry = json.data?.[address];
  if (!entry) return { paid: false, senderAddress: null };

  const balanceLtc = entry.address.balance / 1e8;
  if (balanceLtc < amountLtcExpected * 0.97) return { paid: false, senderAddress: null };

  const senderAddress = await fetchLitecoinSenderAddress(env, entry.transactions?.[0]);
  return { paid: true, senderAddress };
}
