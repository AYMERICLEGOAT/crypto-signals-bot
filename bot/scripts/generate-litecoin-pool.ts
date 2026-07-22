/**
 * Génère un lot d'adresses Litecoin à l'avance et les insère dans la table
 * Supabase `litecoin_address_pool`, consommée par la version Cloudflare
 * Workers du bot (workers/main-worker) — qui ne peut pas dériver de clés
 * elle-même (bitcoinjs-lib/bip32 ne tournent pas sous workerd, voir
 * workers/main-worker/README.md).
 *
 * À relancer quand le pool devient bas :
 *   npm run generate-litecoin-pool -- 100
 *
 * Nécessite LTC_ACCOUNT_XPUB dans bot/.env (voir `npm run generate-ltc-wallet`).
 */

import { createClient } from "@supabase/supabase-js";
import { deriveLitecoinAddress, reserveNextLitecoinIndex } from "../src/payments/litecoin";
import { config } from "../src/config";

async function main() {
  const count = Number(process.argv[2] || "100");
  const supabase = createClient(config.supabase.url, config.supabase.key);

  const rows: { address: string; hd_index: number }[] = [];
  for (let i = 0; i < count; i++) {
    const index = reserveNextLitecoinIndex();
    const address = deriveLitecoinAddress(index);
    rows.push({ address, hd_index: index });
  }

  const { error } = await supabase.from("litecoin_address_pool").insert(rows);
  if (error) throw error;

  console.log(`${rows.length} adresses Litecoin ajoutées au pool (index ${rows[0].hd_index} à ${rows[rows.length - 1].hd_index}).`);
}

main().catch((err) => {
  console.error("Échec de la génération du pool Litecoin:", err);
  process.exit(1);
});
