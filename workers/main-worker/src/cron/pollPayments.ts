import { Env, dbConfig } from "../env";
import { catchUpMissedEvents } from "../blockchain/subscriptionEvents";
import { catchUpUsdtTransfers } from "../blockchain/usdtTransfers";
import { findUserByWalletAddress, activateSubscription, markDiscoveryUsed, setWalletAddress } from "../db/users";
import { getLatestPendingPayment, markPaymentConfirmed, revertPendingPayment, getPendingPayments } from "../db/payments";
import { sendMessage } from "../telegram";
import { isWalletRpcAvailable, checkMoneroPayment } from "../payments/monero";
import { checkLitecoinPayment } from "../payments/litecoin";
import { addDays } from "../utils/date";
import { maybeRewardReferral } from "../bot/referral";
import { consumePendingPromoCode } from "../payments/promoCodes";
import { SupabaseConfig } from "../supabaseRest";
import { PLAN_DURATION_DAYS, DISCOVERY_PLAN, STANDARD_PLAN, isValidPlan } from "../payments/plans";
import { incrementDiscoverySlotsUsed, incrementEarlyAdopterSlotsUsed } from "../db/offerCounter";
import { getUserIfExists } from "../db/users";
import { journaliserErreurUneFois, signalerRetablissement } from "../utils/logUneFois";
import { alerterAdmin } from "../utils/alerteAdmin";

const EARLY_ADOPTER_BONUS_DAYS = 30;

const USDT_AMOUNT_TOLERANCE = 0.97; // tolère 3% d'écart (arrondis, frais éventuels)

function durationForPlan(plan: number): number {
  return isValidPlan(plan) ? PLAN_DURATION_DAYS[plan] : 30;
}

/** À appeler après TOUTE confirmation de paiement (Découverte ou Standard), peu importe la méthode. Exporté pour tests unitaires ciblés. */
export async function onPaymentConfirmed(env: Env, db: SupabaseConfig, telegramId: number, plan: number): Promise<void> {
  if (plan === DISCOVERY_PLAN) {
    await incrementDiscoverySlotsUsed(db);
    await markDiscoveryUsed(db, telegramId);
    return;
  }

  // Bloc 14.3 : mois offert aux 10 premiers abonnés Standard (compteur réel,
  // jamais décoratif -- même principe que le Pack Découverte ci-dessus).
  // L'incrément atomique fait foi (pas un getRemainingEarlyAdopterSlots() lu
  // séparément avant, qui laissait une fenêtre de course pouvant créditer ce
  // bonus deux fois pour un seul quota si deux invocations se chevauchent).
  if (plan === STANDARD_PLAN) {
    const gotSlot = await incrementEarlyAdopterSlotsUsed(db);
    if (!gotSlot) return;

    const user = await getUserIfExists(db, telegramId);
    if (!user?.expiration) return;

    await activateSubscription(db, telegramId, STANDARD_PLAN, addDays(new Date(user.expiration), EARLY_ADOPTER_BONUS_DAYS));
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "🎉 Tu fais partie des 10 premiers abonnés Standard ! Un mois supplémentaire t'a été offert automatiquement."
    );
  }
}

/**
 * Rattrape les événements Subscribed du smart contract — conservé intact
 * pour une réactivation future (voir env.ts, ONCHAIN_CONTRACT_POLLING_ENABLED),
 * mais désactivé par défaut : le flux actif est 100% off-chain (V2, voir
 * processUsdtTransfers), et CONTRACT_ADDRESS pointe sur Amoy (testnet) alors
 * que POLYGON_RPC_URL interroge le mainnet -- sans ce flag explicite, cette
 * fonction consommait un appel RPC public + une écriture Supabase toutes les
 * 5 min sans jamais pouvoir trouver le moindre événement (Audit#16).
 */
async function processUsdtEvents(env: Env): Promise<void> {
  if (env.ONCHAIN_CONTRACT_POLLING_ENABLED !== "true") return;

  const db = dbConfig(env);
  const events = await catchUpMissedEvents(env, db);

  for (const event of events) {
    const user = await findUserByWalletAddress(db, event.user);
    if (!user) {
      console.warn(`[usdt] Paiement on-chain reçu de ${event.user} mais aucun utilisateur Telegram associé.`);
      continue;
    }

    const pending = await getLatestPendingPayment(db, user.telegram_id, "USDT");
    // Réclame ATOMIQUEMENT avant d'agir (voir commentaire détaillé dans
    // processUsdtTransfers ci-dessous) : si `pending` est déjà null ou déjà
    // réclamé par une invocation concurrente, on n'active/crédite rien deux fois.
    if (pending && !(await markPaymentConfirmed(db, pending.id))) continue;

    try {
      await activateSubscription(db, user.telegram_id, event.plan, new Date(event.newExpirationMs));
      await maybeRewardReferral(env, user.telegram_id);
      await consumePendingPromoCode(db, user.telegram_id);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_id, "✅ Paiement USDT confirmé sur la blockchain ! Ton abonnement est actif.");
    } catch (err) {
      if (pending) await revertPendingPayment(db, pending.id);
      throw err;
    }
  }
}

/**
 * Flux USDT 100% off-chain (V2, actif par défaut) : surveille les transferts
 * USDT entrants vers PAYMENT_ADDRESS_USDT, retrouve l'utilisateur par son
 * adresse d'envoi enregistrée, et confirme via son paiement en attente
 * (qui porte déjà le plan choisi) plutôt que de déduire le plan du seul montant.
 */
async function processUsdtTransfers(env: Env): Promise<void> {
  const db = dbConfig(env);
  const transfers = await catchUpUsdtTransfers(env, db);

  for (const transfer of transfers) {
    // LES TROIS SITUATIONS OU DE L'ARGENT ARRIVE SANS QUE L'ACCES PUISSE ETRE
    // OUVERT. Elles se terminaient toutes par un console.warn et un continue :
    // le payeur n'apprenait RIEN, l'administrateur non plus, et la trace
    // mourait dans un journal que personne ne lit.
    //
    // C'est le pire scenario possible pour ce produit. Quelqu'un envoie de
    // l'argent reel, n'obtient aucun acces, aucune explication, et finit par
    // conclure qu'il s'est fait voler. C'est irrattrapable : cette personne ne
    // revient pas, et elle le raconte.
    //
    // Aucune des trois ne peut etre resolue automatiquement — elles demandent
    // une decision humaine (activer a la main, rembourser, reclamer le
    // complement). Une decision humaine suppose que quelqu'un soit au courant.
    const user = await findUserByWalletAddress(db, transfer.from);
    if (!user) {
      // Paiement depuis une adresse jamais declaree : impossible de savoir a
      // QUI ouvrir l'acces. Seul l'administrateur peut trancher.
      console.warn(`[usdt-offchain] Transfert USDT reçu de ${transfer.from} mais aucun utilisateur Telegram associé.`);
      await alerterAdmin(
        env,
        `⚠️ PAIEMENT NON ATTRIBUABLE\n\n${transfer.amount} USDT reçus de ${transfer.from}, ` +
          "mais aucune personne n'a déclaré cette adresse.\n\n" +
          "Quelqu'un a probablement payé depuis un compte d'échange plutôt que depuis son wallet. " +
          "Il attend son accès et ne recevra rien tant que tu n'auras pas agi : /admin_activate."
      );
      continue;
    }

    const pending = await getLatestPendingPayment(db, user.telegram_id, "USDT");
    if (!pending || pending.amount_expected === null) {
      // On sait QUI a paye, mais rien n'etait attendu de sa part.
      console.warn(`[usdt-offchain] Transfert de ${transfer.from} (${transfer.amount} USDT) sans paiement en attente correspondant.`);
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        user.telegram_id,
        `✅ J'ai bien reçu ${transfer.amount} USDT de ta part.\n\n` +
          "En revanche, aucune commande n'était en attente à ton nom — elle a peut-être expiré avant que " +
          "le paiement arrive.\n\n" +
          "Ton argent n'est pas perdu : l'administrateur vient d'être prévenu et va ouvrir ton accès à la main. " +
          "Tu n'as rien d'autre à faire, et surtout ne renvoie rien."
      ).catch((err) => console.error("[usdt-offchain] Notification impossible :", err));
      await alerterAdmin(
        env,
        `⚠️ PAIEMENT SANS COMMANDE\n\n${transfer.amount} USDT reçus de ${user.telegram_id} ` +
          `(${transfer.from}), sans paiement en attente.\n\nIl a été prévenu que tu ouvrirais son accès : ` +
          "/admin_activate."
      );
      continue;
    }
    if (transfer.amount < pending.amount_expected * USDT_AMOUNT_TOLERANCE) {
      // LE CAS LE PLUS CRUEL : on sait qui, on sait combien il manque, et le
      // produit ne disait rien. Un complement ne resoudrait rien tout seul —
      // chaque transfert est evalue isolement, un second envoi de la difference
      // serait rejete pour la meme raison. D'ou l'intervention humaine.
      const manque = Math.max(0, pending.amount_expected - transfer.amount);
      console.warn(`[usdt-offchain] Montant insuffisant de ${transfer.from}: reçu ${transfer.amount}, attendu ${pending.amount_expected}.`);
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        user.telegram_id,
        `⚠️ Paiement reçu, mais incomplet\n\n` +
          `J'ai reçu ${transfer.amount} USDT ; le montant attendu était ${pending.amount_expected} USDT. ` +
          `Il manque environ ${manque.toFixed(2)} USDT.\n\n` +
          "N'envoie PAS le complément : chaque virement est vérifié séparément, un second envoi serait " +
          "également refusé.\n\n" +
          "L'administrateur vient d'être prévenu et va régulariser à la main. Ton argent n'est pas perdu."
      ).catch((err) => console.error("[usdt-offchain] Notification impossible :", err));
      await alerterAdmin(
        env,
        `⚠️ PAIEMENT INSUFFISANT\n\n${user.telegram_id} a envoyé ${transfer.amount} USDT ` +
          `au lieu de ${pending.amount_expected} (manque ${manque.toFixed(2)}).\n\n` +
          "Il a été prévenu de ne pas renvoyer et d'attendre. À toi de trancher : /admin_activate " +
          "pour ouvrir l'accès, ou le contacter."
      );
      continue;
    }

    // Réclame ATOMIQUEMENT ce paiement (PATCH conditionné sur status=eq.pending,
    // voir db/payments.ts) avant toute action : si le cron se chevauche avec
    // une invocation précédente encore en cours (ex: un appel réseau lent),
    // une seule des deux gagne la réclamation -- l'autre voit `false` et
    // s'abstient, ce qui évite double activation + double crédit de parrainage
    // + double message pour le même paiement réel.
    if (!(await markPaymentConfirmed(db, pending.id))) continue;

    try {
      await activateSubscription(db, user.telegram_id, pending.plan, addDays(new Date(), durationForPlan(pending.plan)));
      await maybeRewardReferral(env, user.telegram_id);
      await consumePendingPromoCode(db, user.telegram_id);
      await onPaymentConfirmed(env, db, user.telegram_id, pending.plan);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, user.telegram_id, "✅ Paiement USDT confirmé sur la blockchain ! Ton abonnement est actif.");
    } catch (err) {
      // Si l'activation échoue APRÈS la réclamation (hoquet Supabase
      // transitoire), remet le paiement en attente pour qu'il soit retenté au
      // cycle suivant plutôt que perdu (payé mais jamais activé).
      await revertPendingPayment(db, pending.id);
      throw err;
    }
  }
}

async function processMoneroPayments(env: Env): Promise<void> {
  const db = dbConfig(env);
  if (!(await isWalletRpcAvailable(env))) {
    console.warn("[monero] wallet-rpc injoignable (PC éteint ou ngrok arrêté ?) — nouvelle tentative au prochain cycle.");
    return;
  }

  const pending = await getPendingPayments(db, "XMR");
  for (const payment of pending) {
    if (payment.address_index === null || payment.amount_expected === null) continue;
    try {
      const paid = await checkMoneroPayment(env, payment.address_index, payment.amount_expected);
      if (!paid) continue;

      // Réclame ATOMIQUEMENT (voir commentaire détaillé dans processUsdtTransfers) :
      // évite qu'une invocation qui chevauche une précédente (ex: wallet-rpc lent)
      // ne retraite le même paiement une deuxième fois.
      if (!(await markPaymentConfirmed(db, payment.id))) continue;

      try {
        await activateSubscription(db, payment.telegram_id, payment.plan, addDays(new Date(), durationForPlan(payment.plan)));
        await maybeRewardReferral(env, payment.telegram_id);
        await consumePendingPromoCode(db, payment.telegram_id);
        await onPaymentConfirmed(env, db, payment.telegram_id, payment.plan);
        await sendMessage(env.TELEGRAM_BOT_TOKEN, payment.telegram_id, "✅ Paiement Monero confirmé ! Ton abonnement est actif.");
      } catch (err) {
        await revertPendingPayment(db, payment.id);
        throw err;
      }
    } catch (err) {
      console.error(`[monero] Erreur de vérification pour le paiement #${payment.id}:`, err);
    }
  }
}

async function processLitecoinPayments(env: Env): Promise<void> {
  const db = dbConfig(env);
  const pending = await getPendingPayments(db, "LTC");
  for (const payment of pending) {
    if (!payment.pay_address || payment.amount_expected === null) continue;
    try {
      const { paid, senderAddress } = await checkLitecoinPayment(env, payment.pay_address, payment.amount_expected);
      if (!paid) continue;

      // Anti-abus parrainage (voir bot/referral.ts) : contrairement à USDT,
      // l'adresse de l'acheteur LTC n'était jusqu'ici jamais enregistrée sur
      // `users.wallet_address`, donc un self-referral payé en Litecoin (deux
      // comptes Telegram, même wallet) passait inaperçu. LTC étant une
      // blockchain transparente, on peut retrouver l'expéditeur et
      // l'enregistrer comme pour USDT.
      if (senderAddress) await setWalletAddress(db, payment.telegram_id, senderAddress);

      // Réclame ATOMIQUEMENT (voir commentaire détaillé dans processUsdtTransfers) :
      // évite qu'une invocation qui chevauche une précédente (ex: appel Blockchair
      // lent) ne retraite le même paiement une deuxième fois.
      if (!(await markPaymentConfirmed(db, payment.id))) continue;

      try {
        await activateSubscription(db, payment.telegram_id, payment.plan, addDays(new Date(), durationForPlan(payment.plan)));
        await maybeRewardReferral(env, payment.telegram_id);
        await consumePendingPromoCode(db, payment.telegram_id);
        await onPaymentConfirmed(env, db, payment.telegram_id, payment.plan);
        await sendMessage(env.TELEGRAM_BOT_TOKEN, payment.telegram_id, "✅ Paiement Litecoin confirmé ! Ton abonnement est actif.");
      } catch (err) {
        await revertPendingPayment(db, payment.id);
        throw err;
      }
    } catch (err) {
      console.error(`[litecoin] Erreur de vérification pour le paiement #${payment.id}:`, err);
    }
  }
}

/**
 * Les quatre collecteurs de paiement, chacun isolé des autres.
 *
 * LES ÉCHECS SONT JOURNALISÉS UNE FOIS PAR PANNE, plus un rappel toutes les six
 * heures. Ce cron tourne toutes les cinq minutes : une cause permanente — le
 * RPC Polygon public élague son historique, donc `eth_getLogs` sur un bloc
 * ancien échouera indéfiniment — produisait 288 lignes identiques par jour, au
 * milieu desquelles une vraie panne devenait invisible.
 *
 * Le rétablissement est journalisé lui aussi : sans ça, on ne saurait jamais
 * qu'une panne s'est terminée.
 */
export async function pollPayments(env: Env): Promise<void> {
  const collecteurs: Array<[string, Promise<unknown>]> = [
    ["usdt", processUsdtEvents(env)],
    ["usdt-offchain", processUsdtTransfers(env)],
    ["monero", processMoneroPayments(env)],
    ["litecoin", processLitecoinPayments(env)],
  ];

  await Promise.all(
    collecteurs.map(([cle, promesse]) =>
      promesse
        .then(() => signalerRetablissement(cle))
        .catch((err) => journaliserErreurUneFois(cle, err))
    )
  );
}
