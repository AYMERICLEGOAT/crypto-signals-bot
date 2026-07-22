/**
 * Flux de paiement Litecoin.
 *
 * Contrairement à Monero, Litecoin est une blockchain transparente : une
 * adresse dédiée par facture suffit, et n'importe quel explorateur public
 * (ici Blockchair) peut confirmer un paiement sans clé privée ni clé de vue.
 *
 * Le bot ne détient JAMAIS la seed/mnemonic en fonctionnement normal : il ne
 * connaît que le xpub (clé publique étendue) du compte HD, dérivé une seule
 * fois hors-ligne via `npm run generate-ltc-wallet` (voir scripts/). Avec ce
 * xpub, le bot peut générer et surveiller des adresses de réception, mais ne
 * peut PAS dépenser les fonds reçus — seule la mnemonic (gardée hors-ligne)
 * le permet.
 */

import fs from "fs";
import path from "path";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import { payments as btcPayments, Network } from "bitcoinjs-lib";
import { config } from "../config";
import { usdToCoinAmount } from "./priceConversion";

const bip32 = BIP32Factory(ecc);

// Paramètres réseau Litecoin Mainnet. Le préfixe bip32 (xpub/xprv) reste
// celui de Bitcoin par défaut pour rester compatible avec la plupart des
// wallets HD (Electrum-LTC inclus) — seuls pubKeyHash/scriptHash/wif sont
// spécifiques à Litecoin et déterminent les adresses "L…".
export const LITECOIN_NETWORK: Network = {
  messagePrefix: "\x19Litecoin Signed Message:\n",
  bech32: "ltc",
  bip32: { public: 0x0488b21e, private: 0x0488ade4 },
  pubKeyHash: 0x30,
  scriptHash: 0x32,
  wif: 0xb0,
};

const INDEX_FILE = path.join(__dirname, "..", "..", "data", "ltc_next_index.json");

/** Réserve et persiste le prochain index HD inutilisé (une adresse = une facture, jamais réutilisée). */
export function reserveNextLitecoinIndex(): number {
  let next = 0;
  try {
    next = JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8")).next ?? 0;
  } catch {
    next = 0;
  }
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify({ next: next + 1 }, null, 2));
  return next;
}

function getAccountNode() {
  if (!config.litecoin.accountXpub) {
    throw new Error(
      "LTC_ACCOUNT_XPUB non configuré. Lance `npm run generate-ltc-wallet` (de préférence " +
      "hors-ligne) puis renseigne .env avec le xpub affiché."
    );
  }
  return bip32.fromBase58(config.litecoin.accountXpub, LITECOIN_NETWORK);
}

/** Dérive l'adresse de réception #index (chaîne externe m/.../0/index), en watch-only pur. */
export function deriveLitecoinAddress(index: number): string {
  const account = getAccountNode();
  const child = account.derive(0).derive(index);
  const { address } = btcPayments.p2pkh({
    pubkey: Buffer.from(child.publicKey),
    network: LITECOIN_NETWORK,
  });
  if (!address) throw new Error("Échec de dérivation de l'adresse Litecoin");
  return address;
}

export interface LitecoinInvoice {
  address: string;
  index: number;
  amountLtc: number;
}

export async function createLitecoinInvoice(amountUsd: number): Promise<LitecoinInvoice> {
  const index = reserveNextLitecoinIndex();
  const amountLtc = await usdToCoinAmount(amountUsd, "litecoin");
  const address = deriveLitecoinAddress(index);
  return { address, index, amountLtc };
}

interface BlockchairAddressData {
  address: { balance: number };
}
interface BlockchairAddressResponse {
  data: Record<string, BlockchairAddressData>;
}

/**
 * Vérifie via l'API gratuite Blockchair si `address` a un solde confirmé
 * d'au moins `amountLtcExpected` (tolérance 3% pour les fluctuations de cours).
 */
export async function checkLitecoinPayment(address: string, amountLtcExpected: number): Promise<boolean> {
  const keyParam = config.litecoin.blockchairApiKey ? `&key=${config.litecoin.blockchairApiKey}` : "";
  const url = `https://api.blockchair.com/litecoin/dashboards/address/${address}?limit=0${keyParam}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Blockchair a répondu ${res.status}`);
  const json = (await res.json()) as BlockchairAddressResponse;

  const entry = json.data?.[address];
  if (!entry) return false;

  const balanceLtc = entry.address.balance / 1e8;
  return balanceLtc >= amountLtcExpected * 0.97;
}
