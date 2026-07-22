/**
 * Flux de paiement USDT (Polygon). Comme dans la version Node du bot : le
 * Worker ne demande jamais la clé privée de l'utilisateur et ne soumet
 * aucune transaction en son nom. L'utilisateur signe lui-même approve()
 * puis subscribe() ; le cron catchUpMissedEvents() confirme automatiquement.
 */

import { Env } from "../env";
import { SupabaseConfig } from "../supabaseRest";
import { getPlanPriceUsdt } from "../blockchain/contract";
import { createPendingPayment } from "../db/payments";
import { setWalletAddress } from "../db/users";

const USDT_TOKEN_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";

export async function startUsdtPayment(
  env: Env,
  db: SupabaseConfig,
  telegramId: number,
  plan: 1 | 2,
  walletAddress: string
): Promise<string> {
  await setWalletAddress(db, telegramId, walletAddress);
  const price = await getPlanPriceUsdt(env, plan);
  await createPendingPayment(db, { telegramId, method: "USDT", plan, amountExpected: price });

  return [
    `💳 *Paiement USDT (Polygon) — Plan ${plan} : ${price} USDT / 30 jours*`,
    "",
    "Deux transactions à envoyer toi-même depuis ton wallet (ex: onglet *Write Contract*",
    "sur Polygonscan, en connectant ton wallet) :",
    "",
    "1️⃣ *Approuver* le contrat pour dépenser tes USDT :",
    `   Token USDT : \`${USDT_TOKEN_ADDRESS}\``,
    `   Fonction : approve(spender, amount)`,
    `   spender = \`${env.CONTRACT_ADDRESS}\``,
    `   amount = ${price} USDT (soit ${Math.round(price * 1e6)} en unités brutes, 6 décimales)`,
    "",
    "2️⃣ *Souscrire* sur le contrat d'abonnement :",
    `   Contrat : \`${env.CONTRACT_ADDRESS}\``,
    `   Fonction : subscribe(${plan})`,
    "",
    "✅ Dès que ta transaction `subscribe` est confirmée sur la blockchain, ton abonnement",
    "s'active automatiquement (vérifié toutes les 5 minutes) — aucune autre action de ta part.",
    "Vérifie avec /status.",
    "",
    "⚠️ Le bot ne te demandera jamais ta clé privée ou ta phrase de récupération.",
  ].join("\n");
}
