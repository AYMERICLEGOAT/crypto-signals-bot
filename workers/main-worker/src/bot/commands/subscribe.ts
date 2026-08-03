import { Env, dbConfig } from "../../env";
import { sendMessage, sendPhoto } from "../../telegram";
import { startUsdtPayment } from "../../payments/usdt";
import { createMoneroInvoice } from "../../payments/monero";
import { createLitecoinInvoice } from "../../payments/litecoin";
import { getEffectivePriceUsd } from "../../payments/promoCodes";
import { createPendingPayment } from "../../db/payments";
import { setPendingAction } from "../../db/pendingActions";
import { buildPlanKeyboard, paymentMethodKeyboard, consentKeyboard } from "../keyboards";
import { getRemainingDiscoverySlots } from "../../db/offerCounter";
import { hasWalletClaimedDiscovery } from "../../db/users";
import { PaidPlan, PLAN_PRICES_USD, PLAN_NAMES, PLAN_DURATION_DAYS, DISCOVERY_PLAN, isValidPlan } from "../../payments/plans";

/** Site public — même valeur que SITE_BASE_URL dans .github/workflows/website.yml. */
const TERMS_URL = "https://crypto-signals-bot-site.signalytics.workers.dev/terms.html";

/**
 * État du filtre de tendance au dernier point MESURÉ (voir
 * signals/relative_strength.py::is_market_in_uptrend).
 *
 * Écrit en dur et DATÉ, faute de mieux : le filtre vit côté GitHub Actions et
 * n'écrit aucun état en base, le Worker n'a donc aucune source live à
 * interroger. Un constat daté reste vrai en vieillissant, là où un « en ce
 * moment » sans date deviendrait faux le jour où le marché repasse au-dessus.
 * Interroger la table `signals` ne remplacerait pas ce constat : elle contient
 * encore les signaux de l'ancien moteur, désactivé le 03/08/2026.
 *
 * À METTRE À JOUR le jour où le Bitcoin repasse au-dessus de sa moyenne
 * 200 jours (utilisé ici et dans commands/trial.ts). Correctif durable :
 * faire écrire l'état du filtre par le moteur dans une table, et le lire ici
 * comme n'importe quelle autre donnée.
 */
export const TREND_FILTER_STATUS = {
  measuredOn: "3 août 2026",
  closed: true,
  detail: "le Bitcoin est 10,7 % sous sa moyenne 200 jours",
};

/**
 * Avertissement affiché AVANT le paiement : le produit peut ne rien émettre
 * pendant des mois, et c'est voulu. Il vient en premier message, seul, sans
 * clavier : les boutons d'achat n'arrivent qu'après, pour que le choix se
 * fasse en connaissance de cause et pas à côté d'un bouton.
 *
 * Envoyé sans parse_mode délibérément : c'est un texte long, chargé en
 * pourcentages et en tirets, et un seul caractère mal placé ferait échouer le
 * message ENTIER côté Telegram — c'est-à-dire supprimerait précisément
 * l'avertissement que cette page doit garantir.
 */
function buildSilenceWarning(): string {
  const currentState = TREND_FILTER_STATUS.closed
    ? `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre est FERMÉ : ${TREND_FILTER_STATUS.detail}. ` +
      "Aucun signal ne partira tant que cette moyenne n'aura pas été repassée, et personne ne sait quand " +
      "cela arrivera. Ton abonnement, lui, se compte en jours calendaires à partir du paiement : il peut " +
      "donc arriver à échéance sans que tu aies reçu un seul signal."
    : `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre est ouvert. Il peut se refermer n'importe quand, ` +
      "et ton abonnement se compte en jours calendaires, pas en nombre de signaux.";

  return (
    "⚠️ À LIRE AVANT DE PAYER — ce service se tait, parfois très longtemps.\n\n" +
    "Aucun signal n'est émis quand le Bitcoin est sous sa moyenne 200 jours. Mesuré sur les 6 dernières " +
    "années, ce filtre a été fermé 41 % du temps. La plus longue fermeture a duré 381 jours, soit " +
    "12,7 mois. Il y a eu 11 fermetures d'au moins une semaine, d'une durée médiane de 25 jours.\n\n" +
    `${currentState}\n\n` +
    "Pourquoi on l'assume au lieu de bricoler quelque chose à envoyer : sans ce filtre, la stratégie " +
    "n'est positive que 4 années sur 7. Avec, elle n'a aucune année perdante sur 6 ans — en 2022 et en " +
    "2026 elle n'a simplement rien émis, pendant que détenir les mêmes cryptos coûtait -70,9 % et " +
    "-39,4 %. On préfère ne rien t'envoyer plutôt que de te faire perdre de l'argent.\n\n" +
    "Autant le dire aussi : c'est ce filtre qui fait la majeure partie du travail. Le classement des " +
    "paires par force relative n'ajoute qu'environ 1,1 point. Il n'y a pas d'indicateur magique " +
    "là-dessous, c'est du momentum.\n\n" +
    "Ce que ça a donné pour quelqu'un qui commence à une date au hasard, mesuré sur 6 ans :\n" +
    "• après 6 mois : médiane +5,0 %, 53 % des entrées gagnantes, pire cas -61,7 %\n" +
    "• après 3 mois : médiane 0,0 %, 43 % des entrées gagnantes, pire cas -49,0 %\n\n" +
    "Et quand le filtre est ouvert : 8,0 signaux par semaine, 47,7 % de réussite — donc une majorité de " +
    "signaux perdants, compensée par des gagnants plus gros que les perdants (+16,88 % contre -9,24 % " +
    "en moyenne).\n\n" +
    // Le point le plus important pour quelqu'un qui va payer, et celui qu'un
    // vendeur aurait le plus envie de taire : la distribution est tellement
    // asymétrique que le signal médian PERD. Quelqu'un qui trie les signaux ne
    // garde donc, statistiquement, que la partie perdante de la distribution.
    // Le dire avant le paiement évite exactement le scénario où un abonné
    // suit trois signaux sur douze, perd, et conclut que le service ment.
    "⚠️ La chose la plus importante à comprendre avant de payer : sur 6 ans, le signal MÉDIAN a perdu " +
    "0,69 %. La moyenne est pourtant de +3,22 %. Les deux sont vrais — les 5 % de meilleurs signaux " +
    "apportent la totalité du gain, et sans eux l'espérance tombe à -0,42 %.\n\n" +
    "Concrètement : il faut les prendre TOUS. Si tu comptes choisir ceux qui te semblent les meilleurs, " +
    "tu ne garderas statistiquement que la partie perdante. C'est le filtre qui trie, pas l'intuition. " +
    "Si prendre chaque signal sans exception ne te convient pas, ce service n'est pas fait pour toi, et " +
    "mieux vaut le savoir maintenant.\n\n" +
    "Ce sont des mesures passées, pas une promesse. Le passé ne garantit rien, tu peux perdre de " +
    "l'argent, et rien de tout ceci n'est un conseil en investissement : c'est toi qui décides."
  );
}

export async function handleSubscribeCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const remainingDiscoverySlots = await getRemainingDiscoverySlots(db);
  // Audit#19 : grille simplifiée à 2 paliers pour le lancement (voir keyboards.ts).
  const proPlanVisible = env.PRO_PLAN_VISIBLE === "true";

  // L'avertissement précède les prix, jamais l'inverse : c'est le seul ordre
  // dans lequel l'abonné peut décider en connaissance de cause.
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, buildSilenceWarning());

  const lines = ["📅 *Nos offres*", "", `⭐ Standard — ${PLAN_PRICES_USD[1]} USDT / ${PLAN_DURATION_DAYS[1]} jours`];
  if (proPlanVisible) {
    lines.push(`🎯 Pro — ${PLAN_PRICES_USD[2]} USDT / ${PLAN_DURATION_DAYS[2]} jours (signaux en priorité, avant tout le monde)`);
  }
  if (remainingDiscoverySlots > 0) {
    lines.push(
      `🚀 Découverte — ${PLAN_PRICES_USD[3]} USDT / ${PLAN_DURATION_DAYS[3]} jours ` +
        `(offre de lancement, ${remainingDiscoverySlots} places restantes, une fois par wallet)`
    );
  }
  lines.push("", "Choisis un plan :");

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), {
    markdown: true,
    keyboard: buildPlanKeyboard(remainingDiscoverySlots, proPlanVisible),
  });
}

/** data au format "plan:1", "plan:2" ou "plan:3" */
export async function handlePlanSelection(env: Env, telegramId: number, data: string): Promise<void> {
  const raw = Number(data.split(":")[1]);
  if (!isValidPlan(raw)) return;
  const plan: PaidPlan = raw;

  if (plan === DISCOVERY_PLAN) {
    const db = dbConfig(env);
    const remaining = await getRemainingDiscoverySlots(db);
    if (remaining <= 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "⚠️ Le Pack Découverte est épuisé. Choisis Standard ou Pro avec /subscribe.");
      return;
    }
  }

  // Étape de consentement explicite (audit du 01/08/2026). Les CGV
  // affirmaient la renonciation au droit de rétractation, mais celle-ci
  // n'était jamais RECUEILLIE : le code de la consommation (art. L221-28
  // 13°) exige, pour un contenu numérique exécuté immédiatement, un accord
  // préalable exprès du consommateur ET la reconnaissance expresse qu'il
  // perd son droit de rétractation. Une clause dans les CGV ne suffit pas ;
  // il faut un acte positif avant le paiement. C'est aussi plus honnête :
  // l'abonné sait exactement ce qu'il achète et ce qu'il abandonne.
  //
  // Quatrième point ajouté le 03/08/2026 avec le moteur Force Relative. Les
  // trois premiers restaient vrais mais devenaient insuffisants : combinés
  // (accès immédiat + aucun remboursement), ils décrivaient un abonnement qui
  // peut expirer sans avoir rien délivré, sans que ce cas soit jamais nommé.
  // Il l'est maintenant, et avant le clic — sinon la renonciation au droit de
  // rétractation porterait sur quelque chose que l'abonné n'a pas vu venir.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `Avant de payer, quatre points à valider :\n\n` +
      `• L'accès démarre immédiatement après confirmation du paiement.\n` +
      `• Ton abonnement se compte en jours calendaires, pas en nombre de signaux. Aucun signal n'est émis ` +
      `quand le Bitcoin est sous sa moyenne 200 jours — 41 % du temps sur les 6 dernières années, ` +
      `jusqu'à 381 jours d'affilée. Ton abonnement peut donc se terminer sans aucun signal, et ce cas ` +
      `ne donne pas droit à un remboursement.\n` +
      `• Le paiement se fait en cryptoactifs : il est irréversible, et aucun remboursement n'est possible ` +
      `une fois confirmé. En demandant l'exécution immédiate, tu renonces à ton droit de rétractation de 14 jours.\n` +
      `• Aucune performance n'est garantie. Les signaux ne sont pas un conseil en investissement, ` +
      `et tu peux perdre de l'argent.\n\n` +
      `Conditions complètes : ${TERMS_URL}`,
    { keyboard: consentKeyboard(plan) }
  );
}

/**
 * Consentement donné : on passe seulement maintenant au choix du moyen de
 * paiement. Le clic est tracé côté journal du Worker -- horodatage et
 * identifiant, ce qui constitue la trace de l'accord exprès.
 */
export async function handlePurchaseConsent(env: Env, telegramId: number, data: string): Promise<void> {
  const raw = Number(data.split(":")[1]);
  if (!isValidPlan(raw)) return;
  const plan: PaidPlan = raw;

  console.log(
    `[consentement] telegram_id=${telegramId} plan=${plan} ` +
      `renonciation_retractation=true horodatage=${new Date().toISOString()}`
  );

  // Tunnel de paiement refondu (02/08/2026). Constat qui l'a motivé : la
  // table pending_payments est VIDE depuis le début du projet — pas une
  // seule tentative. Le message se réduisait à « Choisis ton moyen de
  // paiement : » face à trois cryptomonnaies, ce qui n'est pas un choix
  // mais un mur pour qui n'a jamais fait de transaction crypto.
  //
  // Le message répond maintenant aux quatre questions qui bloquent
  // réellement : comment on fait, quoi prendre si on ne sait pas, combien de
  // temps ça prend, et à quoi on s'engage. Le détail complet (réseaux,
  // pièges, frais de retrait) part dans un guide séparé accessible en un
  // bouton, pour ne pas noyer ceux qui savent déjà.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "💳 *Paiement en 3 étapes*\n\n" +
      "1️⃣ Tu choisis ta cryptomonnaie ci-dessous\n" +
      "2️⃣ Je te donne l'adresse et le montant exact\n" +
      "3️⃣ Tu envoies depuis ton exchange ou ton wallet\n\n" +
      "⚡ *Le plus simple : USDT sur Polygon* — frais d'environ 0,01 $, " +
      "disponible sur Binance, Coinbase, Kraken et la plupart des plateformes.\n\n" +
      "⏱️ Ton abonnement sera actif en *2 à 5 minutes* après confirmation, " +
      "automatiquement — rien à envoyer, aucun justificatif.\n\n" +
      "🛡️ *Aucun prélèvement automatique, aucun engagement.* L'abonnement " +
      "s'arrête tout seul à échéance : il n'y a rien à résilier.",
    { markdown: true, keyboard: [[{ text: "📖 Guide de paiement complet", callback_data: "pay:guide" }]] }
  );

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "Choisis ton moyen de paiement :", {
    keyboard: paymentMethodKeyboard(plan),
  });

  // Filet de rassurance : même automatisé, savoir qu'on peut « répondre »
  // lève une hésitation réelle au moment de payer.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "❓ Un doute ? Réponds simplement à ce message, l'administrateur le verra. " +
      "Et /check_payment te donne à tout moment l'état de ta transaction."
  );
}

/** data au format "pay:USDT:1", "pay:XMR:2", "pay:LTC:3" etc. */
export async function handlePaymentMethodSelection(env: Env, telegramId: number, data: string): Promise<void> {
  const [, methodRaw, planRaw] = data.split(":");
  const method = methodRaw as "USDT" | "XMR" | "LTC";
  const rawPlan = Number(planRaw);
  if (!isValidPlan(rawPlan)) return;
  const plan: PaidPlan = rawPlan;
  const db = dbConfig(env);

  if (method === "USDT") {
    await setPendingAction(db, telegramId, { type: "awaiting_wallet_usdt", plan });
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "Envoie-moi l'adresse Polygon (0x...) depuis laquelle tu vas payer, pour que je puisse " +
        "détecter automatiquement ta transaction sur la blockchain."
    );
    return;
  }

  // Monero et Litecoin ne révèlent l'adresse de l'acheteur qu'après paiement :
  // l'anti-abus par wallet du Pack Découverte (une fois par wallet) n'est donc
  // possible que côté USDT (voir db/users.ts hasWalletClaimedDiscovery) — les
  // utilisateurs qui contournent via XMR/LTC restent malgré tout limités par
  // le compteur global de places (getRemainingDiscoverySlots).
  if (plan === DISCOVERY_PLAN) {
    const remaining = await getRemainingDiscoverySlots(db);
    if (remaining <= 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "⚠️ Le Pack Découverte est épuisé. Choisis Standard ou Pro avec /subscribe.");
      return;
    }
  }

  const priceUsd = await getEffectivePriceUsd(db, telegramId, PLAN_PRICES_USD[plan]);

  if (method === "XMR") {
    const invoice = await createMoneroInvoice(env, telegramId, plan, priceUsd);
    await createPendingPayment(db, {
      telegramId,
      method: "XMR",
      plan,
      payAddress: invoice.address,
      addressIndex: invoice.addressIndex,
      amountExpected: invoice.amountXmr,
    });
    if (env.PAYMENT_GUIDE_IMAGE_URL) {
      await sendPhoto(env.TELEGRAM_BOT_TOKEN, telegramId, env.PAYMENT_GUIDE_IMAGE_URL);
    }
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `🟠 *Paiement Monero — ${PLAN_NAMES[plan]}*\n\n` +
        `Envoie *exactement ${invoice.amountXmr.toFixed(6)} XMR* à cette adresse (à usage unique) :\n` +
        `\`${invoice.address}\`\n\n` +
        `Confirmation automatique après ${env.MONERO_MIN_CONFIRMATIONS} confirmations (vérifiée toutes les 5 minutes).`,
      { markdown: true }
    );
    return;
  }

  if (method === "LTC") {
    const invoice = await createLitecoinInvoice(db, telegramId, priceUsd);
    if (!invoice) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        telegramId,
        "⚠️ Le pool d'adresses Litecoin est momentanément épuisé. Choisis USDT ou Monero, " +
          "ou réessaie dans quelques instants."
      );
      return;
    }
    await createPendingPayment(db, {
      telegramId,
      method: "LTC",
      plan,
      payAddress: invoice.address,
      addressIndex: invoice.hdIndex,
      amountExpected: invoice.amountLtc,
    });
    if (env.PAYMENT_GUIDE_IMAGE_URL) {
      await sendPhoto(env.TELEGRAM_BOT_TOKEN, telegramId, env.PAYMENT_GUIDE_IMAGE_URL);
    }
    const ltcUri = `litecoin:${invoice.address}?amount=${invoice.amountLtc.toFixed(6)}`;
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `⚪ *Paiement Litecoin — ${PLAN_NAMES[plan]}*\n\n` +
        `Envoie *exactement ${invoice.amountLtc.toFixed(6)} LTC* à cette adresse (à usage unique) :\n` +
        `\`${invoice.address}\`\n\n` +
        `📱 [Ouvrir directement dans ton wallet](${ltcUri}) (adresse et montant préremplis).\n\n` +
        `Confirmation automatique après détection sur la blockchain (vérifiée toutes les 5 minutes).`,
      { markdown: true }
    );
  }
}
