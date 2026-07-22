/**
 * Flux de paiement USDT (Polygon).
 *
 * Important par design : le bot ne demande JAMAIS la clé privée de
 * l'utilisateur et ne soumet aucune transaction en son nom. L'utilisateur
 * signe lui-même `approve()` puis `subscribe()` depuis son propre wallet
 * (ou via l'onglet "Write Contract" de Polygonscan). Le bot se contente
 * d'afficher les instructions et d'écouter l'événement `Subscribed` on-chain
 * (voir blockchain/subscriptionEvents.ts) pour confirmer automatiquement.
 */

import { getPlanPriceUsdt } from "../blockchain/contract";
import { createPendingPayment } from "../db/payments";
import { setWalletAddress } from "../db/users";
import { config } from "../config";

const USDT_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

export async function startUsdtPayment(telegramId: number, plan: 1 | 2, walletAddress: string): Promise<string> {
  await setWalletAddress(telegramId, walletAddress);
  const price = await getPlanPriceUsdt(plan);
  await createPendingPayment({ telegramId, method: "USDT", plan, amountExpected: price });

  return [
    `💳 *Paiement USDT (Polygon) — Plan ${plan} : ${price} USDT / 30 jours*`,
    "",
    "Deux transactions à envoyer toi-même depuis ton wallet (ex: onglet *Write Contract*",
    "sur Polygonscan, en connectant ton wallet) :",
    "",
    "1️⃣ *Approuver* le contrat pour dépenser tes USDT :",
    `   Token USDT : \`${USDT_TOKEN_ADDRESS}\``,
    `   Fonction : approve(spender, amount)`,
    `   spender = \`${config.polygon.contractAddress}\``,
    `   amount = ${price} USDT (soit ${Math.round(price * 1e6)} en unités brutes, 6 décimales)`,
    "",
    "2️⃣ *Souscrire* sur le contrat d'abonnement :",
    `   Contrat : \`${config.polygon.contractAddress}\``,
    `   Fonction : subscribe(${plan})`,
    "",
    "✅ Dès que ta transaction `subscribe` est confirmée sur la blockchain, ton abonnement",
    "s'active automatiquement — aucune autre action de ta part. Vérifie avec /status.",
    "",
    "⚠️ Le bot ne te demandera jamais ta clé privée ou ta phrase de récupération.",
  ].join("\n");
}
