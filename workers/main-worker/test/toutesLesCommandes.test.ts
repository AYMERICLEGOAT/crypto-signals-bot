import { describe, it, expect, vi, afterEach } from "vitest";
import { routeUpdate } from "../src/bot/router";

/**
 * CHAQUE COMMANDE DOIT RÉPONDRE. C'est tout ce que ce fichier vérifie.
 *
 * Pas ce qu'elle dit — d'autres tests s'en chargent — mais qu'elle produise au
 * moins un message sans lever. Une commande qui plante laisse l'utilisateur
 * devant un silence total : le routeur attrape, journalise, et Telegram ne
 * reçoit jamais rien. Du point de vue de la personne, le bot est mort.
 *
 * Le risque est réel et il s'est déjà matérialisé sur ce projet sous d'autres
 * formes : un `_` non échappé faisait rejeter /help en entier, et l'échec
 * n'apparaissait que dans les journaux.
 *
 * Le test passe par routeUpdate, pas par les handlers directement : c'est le
 * chemin réel, celui qui inclut l'aiguillage, la limitation de débit et la
 * gestion d'erreur. Une commande absente du routeur échoue donc ici même si son
 * handler est parfait.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "t",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
  TELEGRAM_CHANNEL_ID: "-100111",
  TELEGRAM_VIP_CHANNEL_ID: "-100222",
  TELEGRAM_CHANNEL_URL: "https://t.me/ProSignauxPublic",
  ADMIN_TELEGRAM_ID: "42",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
  PAYMENT_ADDRESS_USDT: "0xabc",
} as never;

/** Abonné actif, à vie : le cas où le maximum de branches est traversé. */
const UTILISATEUR = {
  telegram_id: 42,
  plan: 4,
  expiration: "2126-01-01T00:00:00Z",
  trial_used: false,
  discovery_used: false,
  cancelled: false,
  deleted: false,
  plan_started_at: "2026-07-26T00:00:00Z",
  founder_rank: 1,
  wallet_address: null,
  referred_by: null,
  paid_referral_count: 0,
  retention_offer_used: false,
  trial_recap_sent: false,
  survey_sent: false,
  survey_response: null,
  consecutive_losses: 0,
  vip_removed: false,
  reengagement_sent: false,
  pending_promo_code: null,
};

const SIGNAL = {
  id: 1,
  pair: "ICP/USDT",
  type: "BUY",
  entry_price: 2.2,
  stop_loss: 2.0644,
  take_profit: 2.4713,
  tp1_price: 2.3356,
  tp2_price: 2.4713,
  tp3_price: 2.6069,
  created_at: "2026-08-09T02:21:09Z",
  engine: "momentum_4h",
  hold_until: "2026-08-12T02:21:09Z",
  outcome: null,
  outcome_price: null,
  sent: true,
  sent_to_channel: true,
};

function stub() {
  const envois: { chatId: unknown; texte: string }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        const corps = JSON.parse((init?.body as string) ?? "{}");
        if (corps.text || corps.caption) {
          envois.push({ chatId: corps.chat_id, texte: String(corps.text ?? corps.caption) });
        }
        return jsonResponse({ ok: true, result: { message_id: 1, invite_link: "https://t.me/+abc" } });
      }
      // Supabase : on rend une forme plausible pour chaque table interrogée.
      if (url.includes("/users")) return jsonResponse([UTILISATEUR]);
      if (url.includes("signal_deliveries")) return jsonResponse([{ telegram_id: 42, signals: SIGNAL }]);
      if (url.includes("/signals")) return jsonResponse([SIGNAL]);
      if (url.includes("user_prefs")) return jsonResponse([{ telegram_id: 42, trailing_stop: false }]);
      if (url.includes("promo_codes")) return jsonResponse([]);
      if (url.includes("pending_payments")) return jsonResponse([]);
      if (url.includes("offer_counter")) return jsonResponse([{ offer_name: "decouverte", slots_used: 0, slots_total: 50 }]);
      if (url.includes("reviews")) return jsonResponse([]);
      if (url.includes("daily_stats")) return jsonResponse([]);
      if (url.includes("command_rate_limit")) return jsonResponse([{ allowed: true }]);
      if (url.includes("rpc/consume_command_rate_limit")) return jsonResponse([{ allowed: true }]);
      // Marchés : /marche recalcule l'état du filtre en direct.
      if (url.includes("binance") || url.includes("kraken") || url.includes("coinbase") || url.includes("hyperliquid")) {
        return jsonResponse(Array.from({ length: 250 }, (_, i) => [i * 86400000, "0", "0", "0", String(100 + i), "0"]));
      }
      return jsonResponse([]);
    })
  );
  return envois;
}

/**
 * Les 26 commandes du routeur. La liste est écrite À LA MAIN et non dérivée du
 * code : c'est ce qui permet de détecter une commande RETIRÉE du routeur par
 * accident — une liste auto-générée suivrait la régression sans rien dire.
 */
const COMMANDES = [
  "/start",
  "/help",
  "/status",
  "/subscribe",
  "/trial",
  "/pay",
  "/check_payment",
  "/guide_paiement",
  "/code PROMO",
  "/vip",
  "/marche",
  "/carry",
  "/demo",
  "/history",
  "/myperformance",
  "/stats",
  "/trust",
  "/faq",
  "/guide",
  "/prefs",
  "/referral",
  "/review",
  "/cancel",
  "/delete_my_data",
  "/opsnote note de test",
  "/admin_activate 42 1 30",
] as const;

function message(texte: string) {
  return { update_id: 1, message: { message_id: 1, chat: { id: 42 }, from: { id: 42 }, text: texte } } as never;
}

describe("Les 26 commandes répondent toutes", () => {
  afterEach(() => vi.unstubAllGlobals());

  // 20 s : /start envoie trois messages volontairement espaces (voir
  // commands/start.ts), ce qui depasse le delai par defaut de vitest.
  it.each(COMMANDES)("%s produit au moins un message", async (commande) => {
    const envois = stub();
    await expect(routeUpdate(env, message(commande))).resolves.not.toThrow();
    expect(envois.length, `${commande} n'a rien envoyé`).toBeGreaterThan(0);
    expect(envois[0].texte.trim().length, `${commande} a envoyé un message vide`).toBeGreaterThan(0);
  }, 20000);

  it("une commande inconnue ne laisse pas l'utilisateur dans le silence", async () => {
    // Le silence sur une faute de frappe est le pire retour possible : la
    // personne croit le bot mort.
    const envois = stub();
    await routeUpdate(env, message("/commandeQuiNexistePas"));
    expect(envois.length).toBeGreaterThan(0);
  });

  it("un texte libre reçoit une réponse, pas le silence", async () => {
    // C'est ce qu'une personne tape en premier, avant de connaître la
    // moindre commande. Le silence à ce moment-là se lit comme une panne.
    const envois = stub();
    await expect(routeUpdate(env, message("bonjour"))).resolves.not.toThrow();
    expect(envois.length, "aucune réponse à un texte libre").toBeGreaterThan(0);
    expect(envois[0].texte).toMatch(/\/demo|\/marche|\/trial/);
  });
});

describe("Les boutons du menu d'accueil", () => {
  afterEach(() => vi.unstubAllGlobals());

  const BOUTONS = ["start:subscribe", "start:trial", "start:status", "start:demo", "start:help", "start:vip", "start:referral"] as const;

  it.each(BOUTONS)("%s déclenche une réponse", async (data) => {
    const envois = stub();
    const update = {
      update_id: 1,
      callback_query: { id: "cb1", data, from: { id: 42 }, message: { chat: { id: 42 } } },
    } as never;
    await expect(routeUpdate(env, update)).resolves.not.toThrow();
    expect(envois.length, `${data} n'a rien envoyé`).toBeGreaterThan(0);
  });
});
