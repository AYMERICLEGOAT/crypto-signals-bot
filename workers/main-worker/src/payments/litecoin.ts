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
  data: Record<string, { address: { balance: number } }>;
}

export async function checkLitecoinPayment(env: Env, address: string, amountLtcExpected: number): Promise<boolean> {
  const keyParam = env.BLOCKCHAIR_API_KEY ? `&key=${env.BLOCKCHAIR_API_KEY}` : "";
  const url = `https://api.blockchair.com/litecoin/dashboards/address/${address}?limit=0${keyParam}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blockchair a répondu ${res.status}`);
  const json = (await res.json()) as BlockchairAddressResponse;

  const entry = json.data?.[address];
  if (!entry) return false;

  const balanceLtc = entry.address.balance / 1e8;
  return balanceLtc >= amountLtcExpected * 0.97;
}
