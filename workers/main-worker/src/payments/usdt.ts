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
import { setWalletAddress, hasWalletClaimedDiscovery } from "../db/users";
import { getEffectivePriceUsd } from "./promoCodes";
import { PaidPlan, PLAN_PRICES_USD, PLAN_DURATION_DAYS, PLAN_NAMES, DISCOVERY_PLAN } from "./plans";

const USDT_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

export async function startUsdtPayment(
  env: Env,
  db: SupabaseConfig,
  telegramId: number,
  plan: PaidPlan,
  walletAddress: string
): Promise<string> {
  // Anti-abus Pack Découverte (Bloc 2.2, "une seule fois par wallet") : seule
  // méthode où l'adresse de l'acheteur est connue avant paiement, voir
  // db/users.ts hasWalletClaimedDiscovery.
  if (plan === DISCOVERY_PLAN && (await hasWalletClaimedDiscovery(db, walletAddress))) {
    return (
      "⚠️ Cette adresse a déjà utilisé le Pack Découverte (offre valable une seule fois par wallet).\n\n" +
      "Choisis le plan Standard ou Pro avec /subscribe pour continuer."
    );
  }

  await setWalletAddress(db, telegramId, walletAddress);
  const price = await getEffectivePriceUsd(db, telegramId, PLAN_PRICES_USD[plan]);
  await createPendingPayment(db, { telegramId, method: "USDT", plan, amountExpected: price });

  return [
    `💳 *Paiement USDT (Polygon) — ${PLAN_NAMES[plan]} : ${price} USDT / ${PLAN_DURATION_DAYS[plan]} jours*`,
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
