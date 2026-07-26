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
  // Lien public (https://t.me/...) du même canal, affiché aux utilisateurs (TELEGRAM_CHANNEL_ID
  // est l'identifiant numérique interne, pas cliquable/lisible pour un humain).
  TELEGRAM_CHANNEL_URL?: string;
  // Canal VIP privé (abonnés Standard/Pro/Découverte, voir /vip) — optionnel :
  // si absent, /vip explique qu'il n'est pas encore configuré plutôt que
  // d'échouer silencieusement. Le bot doit être admin de ce chat avec le
  // droit "inviter des utilisateurs" (voir bot/commands/vip.ts).
  TELEGRAM_VIP_CHANNEL_ID?: string;
  // Adresse de réception USDT (V2 100% off-chain) — pas un secret, une adresse
  // publique de wallet. Si absent, processUsdtTransfers() ne fait rien.
  PAYMENT_ADDRESS_USDT?: string;
  // Image explicative (signals/generate_payment_guide.py), envoyée avec /pay
  // et les instructions de paiement USDT/LTC/XMR.
  PAYMENT_GUIDE_IMAGE_URL?: string;
  // Telegram ID de l'administrateur — gate la commande /stats.
  ADMIN_TELEGRAM_ID?: string;
  // "false" tant qu'on n'a pas assez de signaux réels accumulés (30+ jours,
  // voir Bloc 4) pour afficher un taux de réussite EN CONDITIONS RÉELLES
  // plutôt que le backtest in-sample. Scaffold pour l'instant, pas encore lu.
  DISPLAY_WINRATE?: string;
  // Audit#16 : le flux de paiement actif est 100% off-chain (V2, voir
  // processUsdtTransfers). CONTRACT_ADDRESS pointe sur Amoy (testnet) alors
  // que POLYGON_RPC_URL interroge le mainnet -- ça désactivait déjà
  // *implicitement* processUsdtEvents (aucun log ne peut jamais matcher),
  // mais le cron continuait à consommer un appel RPC public + une écriture
  // Supabase toutes les 5 min pour rien, sans que ce soit une décision
  // explicite et documentée. "true" pour réactiver un jour un vrai flux
  // on-chain (contrat mainnet réel + CONTRACT_ADDRESS à jour) ; "false"/absent
  // = désactivé (défaut).
  ONCHAIN_CONTRACT_POLLING_ENABLED?: string;
  // Audit#19 : grille tarifaire simplifiée à 2 paliers visibles (Standard +
  // Découverte tant qu'il reste des places) pour le lancement — Pro reste
  // entièrement fonctionnel (voir payments/plans.ts) mais masqué de
  // /subscribe tant que ce flag n'est pas "true" (voir bot/keyboards.ts).
  PRO_PLAN_VISIBLE?: string;
}

export function dbConfig(env: Env): SupabaseConfig {
  return { url: env.SUPABASE_URL, key: env.SUPABASE_KEY };
}
