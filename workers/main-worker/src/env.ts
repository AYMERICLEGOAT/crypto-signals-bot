/**
 * Bindings d'environnement du Worker (variables + secrets Wrangler).
 * Sur Workers, il n'y a pas de process.env : tout est injecté via le
 * paramètre `env` de fetch()/scheduled() (voir wrangler.toml + `wrangler secret put`).
 */

import { SupabaseConfig } from "./supabaseRest";

export interface Env {
  // Secrets (wrangler secret put)
  TELEGRAM_BOT_TOKEN: string;
  // Vérifié contre l'en-tête X-Telegram-Bot-Api-Secret-Token sur chaque appel
  // webhook : sans ça, l'URL du webhook est un endpoint public non authentifié
  // qui pourrait déclencher des commandes (dont /trial, qui dépense du gas
  // depuis le wallet admin) pour n'importe qui la découvre.
  TELEGRAM_WEBHOOK_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  ADMIN_PRIVATE_KEY: string;
  MONERO_WALLET_RPC_URL?: string;
  MONERO_WALLET_RPC_USER?: string;
  MONERO_WALLET_RPC_PASSWORD?: string;
  BLOCKCHAIR_API_KEY?: string;

  // Variables non sensibles (wrangler.toml [vars])
  POLYGON_RPC_URL: string;
  CONTRACT_ADDRESS: string;
  MONERO_MIN_CONFIRMATIONS: string;
  LTC_MIN_CONFIRMATIONS: string;
  // Utilisé pour construire les liens de parrainage (https://t.me/<username>?start=<code>).
  TELEGRAM_BOT_USERNAME: string;
  // Canal public gratuit (diffusion différée) — optionnel : si absent, dispatchPublicChannel() ne fait rien.
  TELEGRAM_CHANNEL_ID?: string;
}

export function dbConfig(env: Env): SupabaseConfig {
  return { url: env.SUPABASE_URL, key: env.SUPABASE_KEY };
}
