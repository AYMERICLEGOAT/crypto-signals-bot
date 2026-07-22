/**
 * Flux de paiement USDT (Polygon) — 100% off-chain (V2) : l'utilisateur
 * envoie directement l'USDT à l'adresse de réception configurée
 * (PAYMENT_ADDRESS_USDT). Pas de smart contract impliqué dans le paiement :
 * le cron `processUsdtTransfers` (voir cron/pollPayments.ts) surveille les
 * transferts USDT entrants et active l'abonnement automatiquement.
 *
 * Le contrat SignalSubscription.sol reste écrit, testé et déployable (voir
 * contract/) pour une migration future optionnelle — simplement pas utilisé
 * pour le paiement tant qu'il n'est pas déployé sur mainnet.
 */

import { Env } from "../env";
import { SupabaseConfig } from "../supabaseRest";
import { createPendingPayment } from "../db/payments";
import { setWalletAddress } from "../db/users";

const USDT_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

// Prix fixes (alignés sur les constantes PLAN1_PRICE/PLAN2_PRICE du contrat,
// pour rester cohérent si le contrat est réactivé plus tard).
export const USDT_PLAN_PRICES: Record<1 | 2, number> = { 1: 10, 2: 25 };

export async function startUsdtPayment(
  env: Env,
  db: SupabaseConfig,
  telegramId: number,
  plan: 1 | 2,
  walletAddress: string
): Promise<string> {
  await setWalletAddress(db, telegramId, walletAddress);
  const price = USDT_PLAN_PRICES[plan];
  await createPendingPayment(db, { telegramId, method: "USDT", plan, amountExpected: price });

  return [
    `💳 *Paiement USDT (Polygon) — Plan ${plan} : ${price} USDT / 30 jours*`,
    "",
    `Envoie *exactement ${price} USDT* (réseau Polygon) depuis l'adresse `,
    `\`${walletAddress}\` vers :`,
    `\`${env.PAYMENT_ADDRESS_USDT}\``,
    "",
    `Token USDT (Polygon) : \`${USDT_TOKEN_ADDRESS}\` — vérifie bien que ton wallet`,
    "envoie sur le réseau Polygon, pas Ethereum mainnet.",
    "",
    "✅ Dès que le transfert est confirmé sur la blockchain, ton abonnement s'active",
    "automatiquement (vérifié toutes les 5 minutes) — aucune autre action de ta part.",
    "Vérifie avec /status.",
    "",
    "⚠️ Le bot ne te demandera jamais ta clé privée ou ta phrase de récupération.",
  ].join("\n");
}
