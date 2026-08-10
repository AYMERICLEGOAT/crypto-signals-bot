import { describe, it, expect, vi, afterEach } from "vitest";
import { pollPayments } from "../src/cron/pollPayments";

/**
 * QUAND DE L'ARGENT ARRIVE ET QUE L'ACCÈS NE PEUT PAS S'OUVRIR.
 *
 * Trois chemins se terminaient par un `console.warn` et un `continue` : le
 * payeur n'apprenait rien, l'administrateur non plus, et la trace mourait dans
 * un journal Cloudflare que personne ne lit.
 *
 * C'est le pire scénario de ce produit. Quelqu'un envoie de l'argent réel,
 * n'obtient aucun accès, aucune explication, et conclut qu'il s'est fait voler.
 * Irrattrapable : cette personne ne revient pas, et elle le raconte.
 *
 * Aucun de ces cas ne se résout automatiquement — d'où l'alerte à
 * l'administrateur, qui est le seul à pouvoir trancher.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const ADMIN = 8647576528;
const PAYEUR = 42;

const env = {
  TELEGRAM_BOT_TOKEN: "t",
  ADMIN_TELEGRAM_ID: String(ADMIN),
  PAYMENT_ADDRESS_USDT: "0x71367B5f4519700a63c2564b754cF9593170000a",
  POLYGON_RPC_URL: "https://rpc.test",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
} as never;

const BLOC = 91_770_254;

interface Options {
  /** L'expéditeur est-il un utilisateur connu ? */
  utilisateurConnu?: boolean;
  /** Montant attendu, ou null pour « aucune commande en attente ». */
  attendu?: number | null;
  /** Montant réellement transféré. */
  recu?: number;
}

/**
 * Un transfert USDT unique, forgé dans le journal de la blockchain.
 * `0x...0f4240` = 1 000 000 unités = 1 USDT (6 décimales).
 */
function stub(opts: Options = {}) {
  const messages: { a: number; texte: string }[] = [];
  const recu = opts.recu ?? 18;
  const montantHex = BigInt(Math.round(recu * 1e6)).toString(16).padStart(64, "0");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        const b = JSON.parse((init?.body as string) ?? "{}");
        if (b.text) messages.push({ a: Number(b.chat_id), texte: String(b.text) });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      if (url.includes("rpc.test")) {
        const corps = JSON.parse(init!.body as string);
        if (corps.method === "eth_blockNumber") return jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x" + BLOC.toString(16) });
        if (corps.method === "eth_getLogs") {
          return jsonResponse({
            jsonrpc: "2.0",
            id: 1,
            result: [
              {
                transactionHash: "0xdead",
                data: "0x" + montantHex,
                topics: [
                  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                  "0x000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                  "0x00000000000000000000000071367b5f4519700a63c2564b754cf9593170000a",
                ],
              },
            ],
          });
        }
        return jsonResponse({ jsonrpc: "2.0", id: 1, result: null });
      }
      if (url.includes("chain_state")) return jsonResponse([{ key: "x", value: String(BLOC - 10) }]);
      if (url.includes("payment_cache")) return jsonResponse([]);
      if (url.includes("pending_payments")) {
        if (opts.attendu == null) return jsonResponse([]);
        return jsonResponse([{ id: 1, plan: 1, amount_expected: opts.attendu, status: "pending" }]);
      }
      if (url.includes("/users")) {
        return jsonResponse(opts.utilisateurConnu === false ? [] : [{ telegram_id: PAYEUR, plan: null, expiration: null }]);
      }
      return jsonResponse([]);
    })
  );

  return {
    messages,
    versLePayeur: () => messages.filter((m) => m.a === PAYEUR),
    versLAdmin: () => messages.filter((m) => m.a === ADMIN),
  };
}

describe("Paiement depuis une adresse inconnue", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("alerte l'administrateur, seul à pouvoir trancher", async () => {
    // On ne sait pas À QUI ouvrir l'accès : aucune automatisation possible.
    const s = stub({ utilisateurConnu: false, recu: 19 });
    await pollPayments(env);
    expect(s.versLAdmin().length, "administrateur non prévenu").toBeGreaterThan(0);
    expect(s.versLAdmin()[0].texte).toMatch(/NON ATTRIBUABLE/);
  });

  it("mentionne le montant ET l'adresse, sans quoi l'alerte est inutile", async () => {
    const s = stub({ utilisateurConnu: false, recu: 19 });
    await pollPayments(env);
    const texte = s.versLAdmin()[0].texte;
    expect(texte).toContain("19");
    expect(texte.toLowerCase()).toContain("0xaaaa");
  });
});

describe("Paiement sans commande en attente", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prévient le payeur que son argent n'est pas perdu", async () => {
    const s = stub({ attendu: null, recu: 19 });
    await pollPayments(env);
    expect(s.versLePayeur().length, "le payeur n'a rien reçu").toBeGreaterThan(0);
    expect(s.versLePayeur()[0].texte).toMatch(/pas perdu/i);
  });

  it("lui dit de NE PAS renvoyer", async () => {
    // Sans cette phrase, le réflexe naturel est de payer une seconde fois.
    const s = stub({ attendu: null, recu: 19 });
    await pollPayments(env);
    expect(s.versLePayeur()[0].texte).toMatch(/ne renvoie rien/i);
  });

  it("alerte aussi l'administrateur", async () => {
    const s = stub({ attendu: null, recu: 19 });
    await pollPayments(env);
    expect(s.versLAdmin().length).toBeGreaterThan(0);
  });
});

describe("Paiement insuffisant — le cas le plus cruel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("chiffre ce qui manque", async () => {
    // On sait qui, on sait combien il manque, et le produit ne disait rien.
    const s = stub({ attendu: 19, recu: 15 });
    await pollPayments(env);
    expect(s.versLePayeur().length).toBeGreaterThan(0);
    expect(s.versLePayeur()[0].texte).toContain("4.00");
  });

  it("interdit explicitement d'envoyer le complément", async () => {
    // Un second virement serait évalué SEUL, donc refusé pour la même raison.
    // Sans cet avertissement, la personne perd de l'argent une deuxième fois.
    const s = stub({ attendu: 19, recu: 15 });
    await pollPayments(env);
    expect(s.versLePayeur()[0].texte).toMatch(/N'envoie PAS le compl/i);
  });

  it("alerte l'administrateur avec les deux montants", async () => {
    const s = stub({ attendu: 19, recu: 15 });
    await pollPayments(env);
    const texte = s.versLAdmin()[0].texte;
    expect(texte).toMatch(/INSUFFISANT/);
    expect(texte).toContain("15");
    expect(texte).toContain("19");
  });
});

describe("Un paiement VALIDE ne déclenche aucune alerte", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ne dérange pas l'administrateur pour un paiement normal", async () => {
    // Une alerte qui part à chaque paiement réussi serait ignorée en une
    // semaine — et les vraies avec elle.
    const s = stub({ attendu: 19, recu: 19 });
    await pollPayments(env);
    for (const m of s.versLAdmin()) {
      expect(m.texte).not.toMatch(/INSUFFISANT|NON ATTRIBUABLE|SANS COMMANDE/);
    }
  });
});
