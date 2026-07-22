/**
 * Chargement et validation des variables d'environnement.
 * Toute variable obligatoire manquante fait échouer le démarrage immédiatement
 * (mieux vaut un crash clair au lancement qu'un bug silencieux en production).
 */

import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${name} (voir .env.example)`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  telegram: {
    botToken: required("TELEGRAM_BOT_TOKEN"),
    // Utilisé pour construire les liens de parrainage (https://t.me/<username>?start=<code>).
    botUsername: optional("TELEGRAM_BOT_USERNAME", "ProVIPSignals_bot"),
  },
  supabase: {
    url: required("SUPABASE_URL"),
    key: required("SUPABASE_KEY"),
  },
  polygon: {
    rpcUrl: optional("POLYGON_RPC_URL", "https://polygon-rpc.com"),
    contractAddress: required("CONTRACT_ADDRESS"),
    // Clé du wallet OWNER du contrat : signe setTrial() et withdraw().
    // ⚠️ Très sensible — voir les avertissements du README.
    adminPrivateKey: required("ADMIN_PRIVATE_KEY"),
  },
  monero: {
    // URL locale (http://127.0.0.1:18082/json_rpc) ou tunnel ngrok si le bot
    // tourne ailleurs que sur le PC qui héberge monero-wallet-rpc.
    walletRpcUrl: process.env.MONERO_WALLET_RPC_URL || "",
    walletRpcUser: process.env.MONERO_WALLET_RPC_USER || "",
    walletRpcPassword: process.env.MONERO_WALLET_RPC_PASSWORD || "",
    minConfirmations: Number(optional("MONERO_MIN_CONFIRMATIONS", "10")),
  },
  litecoin: {
    // xpub (clé publique étendue) du compte HD dédié au watch-only des paiements.
    // Générée une fois hors-ligne via `npm run generate-ltc-wallet` (voir scripts/).
    accountXpub: process.env.LTC_ACCOUNT_XPUB || "",
    blockchairApiKey: process.env.BLOCKCHAIR_API_KEY || "",
    minConfirmations: Number(optional("LTC_MIN_CONFIRMATIONS", "1")),
  },
  polling: {
    paymentCheckIntervalMs: Number(optional("PAYMENT_CHECK_INTERVAL_MS", String(2 * 60 * 1000))),
    signalDispatchIntervalMs: Number(optional("SIGNAL_DISPATCH_INTERVAL_MS", String(5 * 60 * 1000))),
    eventCatchupIntervalMs: Number(optional("EVENT_CATCHUP_INTERVAL_MS", String(60 * 1000))),
  },
};
