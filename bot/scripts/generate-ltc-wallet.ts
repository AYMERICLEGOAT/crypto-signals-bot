/**
 * À exécuter UNE SEULE FOIS, de préférence sur une machine hors-ligne :
 *   npm run generate-ltc-wallet
 *
 * Génère une nouvelle phrase mnémonique (BIP39) et affiche le xpub du compte
 * HD Litecoin (m/44'/2'/0'). Le xpub va dans bot/.env (LTC_ACCOUNT_XPUB) —
 * la mnemonic, elle, ne doit JAMAIS toucher ce serveur : note-la hors-ligne
 * (papier) et importe-la dans un wallet (ex: Electrum-LTC) uniquement pour
 * retirer les fonds reçus.
 */

import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from "tiny-secp256k1";
import { LITECOIN_NETWORK } from "../src/payments/litecoin";

const bip32 = BIP32Factory(ecc);

function main() {
  const mnemonic = bip39.generateMnemonic(256); // 24 mots
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const root = bip32.fromSeed(seed, LITECOIN_NETWORK);
  const account = root.derivePath("m/44'/2'/0'"); // BIP44, coin_type 2 = Litecoin
  const accountXpub = account.neutered().toBase58();

  console.log("=== NOUVEAU WALLET LITECOIN (HD, watch-only pour le bot) ===\n");
  console.log("Phrase mnémonique (24 mots) — À NOTER HORS-LIGNE. Ne jamais la partager,");
  console.log("ne jamais la committer, ne jamais la mettre sur le serveur du bot :\n");
  console.log(`  ${mnemonic}\n`);
  console.log("Clé publique de compte (xpub) — à mettre dans bot/.env sous LTC_ACCOUNT_XPUB :\n");
  console.log(`  ${accountXpub}\n`);
  console.log(
    "Le bot ne connaît que ce xpub : il peut générer des adresses de réception et\n" +
    "surveiller les paiements, mais ne peut PAS dépenser les fonds. Pour retirer les\n" +
    "LTC reçus, importe la phrase mnémonique ci-dessus dans un wallet (ex: Electrum-LTC),\n" +
    "idéalement depuis une machine hors-ligne."
  );
}

main();
