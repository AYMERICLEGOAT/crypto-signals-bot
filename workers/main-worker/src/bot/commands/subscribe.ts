import { Env, dbConfig } from "../../env";
import { sendMessage, sendPhoto, InlineKeyboard } from "../../telegram";
import { createMoneroInvoice, isWalletRpcAvailable } from "../../payments/monero";
import { createLitecoinInvoice } from "../../payments/litecoin";
import { getEffectivePriceUsd } from "../../payments/promoCodes";
import { createPendingPayment } from "../../db/payments";
import { setPendingAction, consumePendingAction } from "../../db/pendingActions";
import { buildPlanKeyboard, consentKeyboard } from "../keyboards";
import { getRemainingDiscoverySlots } from "../../db/offerCounter";
import { PaidPlan, PLAN_PRICES_USD, PLAN_NAMES, PLAN_DURATION_DAYS, DISCOVERY_PLAN, isValidPlan } from "../../payments/plans";

/** Site public — même valeur que SITE_BASE_URL dans .github/workflows/website.yml. */
const TERMS_URL = "https://crypto-signals-bot-site.signalytics.workers.dev/terms.html";

/**
 * Durée de vie d'une adresse de paiement, alignée sur
 * PENDING_PAYMENT_STALE_DAYS (cron/dailyMaintenance.ts). Annoncée à l'acheteur
 * plutôt que subie : sans elle, une adresse pouvait expirer en silence et
 * l'acheteur qui payait ensuite n'avait aucune idée de ce qui se passait.
 */
const PAYMENT_ADDRESS_VALID_DAYS = 7;

/**
 * État du filtre de tendance au dernier point MESURÉ (voir
 * signals/relative_strength.py::is_market_in_uptrend).
 *
 * Écrit en dur et DATÉ, faute de mieux : le filtre vit côté GitHub Actions et
 * n'écrit aucun état en base, le Worker n'a donc aucune source live à
 * interroger. Un constat daté reste vrai en vieillissant, là où un « en ce
 * moment » sans date deviendrait faux le jour où le marché repasse au-dessus.
 *
 * À METTRE À JOUR le jour où le Bitcoin repasse au-dessus de sa moyenne
 * 200 jours (lu aussi par commands/start.ts, help.ts, faq.ts et trial.ts).
 * Correctif durable : faire écrire l'état du filtre par le moteur dans une
 * table, et le lire ici comme n'importe quelle autre donnée.
 *
 * `detail` ne porte plus d'écart chiffré : cet écart bouge tous les jours et
 * personne ne le remet à jour à ce rythme — un chiffre faux sur une page de
 * vente est exactement ce que ce projet s'interdit.
 */
export const TREND_FILTER_STATUS = {
  measuredOn: "4 août 2026",
  closed: true,
  detail: "le Bitcoin est sous sa moyenne 200 jours",
};

/**
 * Écran 1 du tunnel : ce qu'on reçoit, avant tout le reste.
 *
 * Refonte du 04/08/2026. Le tunnel commençait par un mur d'avertissements de
 * ~2 400 caractères, avant même qu'un prix soit affiché : le tout premier
 * contact avec l'offre était une liste de raisons de ne pas acheter. Dire ce
 * qu'on vend d'abord n'est pas moins honnête — les avertissements arrivent au
 * message suivant, toujours AVANT les prix et AVANT le paiement.
 *
 * Envoyé sans parse_mode, comme tous les longs textes de ce projet : un seul
 * caractère mal placé ferait échouer le message ENTIER côté Telegram.
 */
function buildValueScreen(): string {
  return (
    "📡 CE QUE TU REÇOIS\n\n" +
    "Cinq familles de signaux indépendantes, validées sur 6 ans avec un témoin aléatoire — " +
    "c'est-à-dire comparées à un tirage au sort, pour vérifier qu'elles font mieux que la chance.\n\n" +
    "• Quand le marché est favorable : 4,35 signaux par jour\n" +
    "• Quand il ne l'est pas : 1,15 par jour\n" +
    "• Moyenne sur toute la période : 2,99 par jour\n" +
    "• 80 % des jours ont au moins un signal\n\n" +
    "Chaque signal arrive ici avec son entrée, son stop et ses paliers, et il est suivi " +
    "automatiquement jusqu'à la clôture."
  );
}

/**
 * Écran 2 : le carry de financement.
 *
 * C'est de très loin le meilleur argument du produit — 84,2 % de positions
 * gagnantes, et la mieux établie de celles qui produisent quand le marché est
 * défavorable —
 * et il était jusqu'ici totalement absent du tunnel de paiement. Un visiteur
 * qui arrivait aujourd'hui, filtre de tendance fermé, ne lisait qu'une seule
 * chose : « tu vas payer pour du silence ». C'était faux, et c'était le
 * message le plus décourageant possible.
 */
function buildCarryScreen(): string {
  const marketContext = TREND_FILTER_STATUS.closed
    ? `Au ${TREND_FILTER_STATUS.measuredOn}, ${TREND_FILTER_STATUS.detail}. Trois de nos cinq familles sont ` +
      "donc à l'arrêt. Deux continuent : le carry, et le momentum 4H qui ne travaille QUE dans ce régime. " +
      "Le carry est le mieux établi des deux."
    : `Au ${TREND_FILTER_STATUS.measuredOn}, quatre des cinq familles tournent. Celle-ci a ceci de ` +
      "particulier qu'elle continue même quand les directionnelles sont coupées.";

  return (
    "🔁 LE CARRY DE FINANCEMENT\n\n" +
    `${marketContext}\n\n` +
    "Le principe, sans jargon : on achète au comptant, et on vend à découvert le contrat perpétuel, pour le " +
    "même montant. Les deux jambes s'annulent — que le prix monte ou qu'il baisse, la position ne bouge pas. " +
    "Le gain vient uniquement du financement que les acheteurs de perpétuels versent aux vendeurs.\n\n" +
    "Mesuré sur 6 ans :\n" +
    "• 84,2 % de positions gagnantes\n" +
    "• +0,572 % net par position\n" +
    "• 6 années positives sur 7 — la septième, 2022, à -0,046 %, donc plate\n\n" +
    "Ce n'est pas sans risque, et nous n'écrirons jamais le contraire : la jambe vendeuse peut être liquidée " +
    "si la marge devient insuffisante, la plateforme sur laquelle tu es peut faire défaut, et une journée de " +
    "financement extrême peut coûter jusqu'à -19,86 % sur une position.\n\n" +
    "En ce moment, 4 carrys sont ouverts : ZRO, XMR, SKY, LDO."
  );
}

/**
 * Écran 3 : ce qui pourrait faire regretter l'achat. Vient AVANT les prix,
 * jamais après — c'est le seul ordre dans lequel le choix se fait en
 * connaissance de cause.
 *
 * Réécrit le 04/08/2026 : la version précédente affirmait qu'« aucun signal
 * n'est émis quand le Bitcoin est sous sa moyenne 200 jours ». C'était vrai du
 * moteur d'hier, et c'est devenu FAUX avec le carry, qui produit précisément
 * dans ce régime. Un avertissement faux ne protège personne : il décourage
 * l'achat sans rien apprendre de vrai.
 */
function buildSilenceWarning(): string {
  const currentState = TREND_FILTER_STATUS.closed
    ? `C'est le cas aujourd'hui : au ${TREND_FILTER_STATUS.measuredOn}, ${TREND_FILTER_STATUS.detail}, ` +
      "et ce sont le carry et le momentum 4H qui produisent."
    : `Au ${TREND_FILTER_STATUS.measuredOn}, le filtre est ouvert. Il peut se refermer n'importe quand, ` +
      "sans préavis.";

  return (
    "⚠️ À LIRE AVANT DE PAYER\n\n" +
    "Trois choses qui pourraient te faire regretter cet achat. Autant te les dire maintenant.\n\n" +
    "1. Le service peut devenir très calme, longtemps.\n" +
    "Les trois familles directionnelles sont coupées dès que le Bitcoin passe sous sa moyenne 200 jours. " +
    "Sur 6 ans, ça représente 41 % du temps, avec un record de 381 jours d'affilée, du 28/12/2021 au " +
    "13/01/2023. Le carry, lui, continue — mais le rythme tombe alors à 1,15 signal par jour au lieu de " +
    `4,35. ${currentState}\n` +
    "Ton abonnement, lui, se compte en jours calendaires : il court pendant ces périodes, et il peut " +
    "arriver à échéance dans un marché resté calme du début à la fin.\n\n" +
    // Le point que n'importe quel vendeur aurait envie de taire, et le plus
    // utile de tous : la distribution est si asymétrique que le signal médian
    // PERD. Trier les signaux revient donc à ne garder que la partie perdante.
    // Le dire avant le paiement évite exactement le scénario où un abonné suit
    // trois signaux sur douze, perd, et conclut que le service ment.
    "2. Il faut prendre TOUS les signaux directionnels.\n" +
    "Environ un sur deux est gagnant, et surtout : le signal MÉDIAN perd 0,69 %. La rentabilité vient d'une " +
    "minorité de gros gagnants. Si tu comptes ne garder que ceux qui te semblent les meilleurs, tu ne " +
    "conserveras statistiquement que la partie perdante. Si prendre chaque signal sans exception ne te " +
    "convient pas, ce service n'est pas fait pour toi — et mieux vaut le savoir avant de payer.\n\n" +
    "3. Voilà ce qu'a vécu quelqu'un entré à une date au hasard.\n" +
    "Mesuré sur 6 ans, après six mois : médiane +5,0 %, 53 % des entrées gagnantes, et pire cas -61,7 %.\n\n" +
    "Ce sont des mesures passées, pas une promesse. Le passé ne garantit rien, tu peux perdre de l'argent, " +
    "et rien de tout ceci n'est un conseil en investissement : c'est toi qui décides."
  );
}

export async function handleSubscribeCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const remainingDiscoverySlots = await getRemainingDiscoverySlots(db);
  // Audit#19 : grille simplifiée à 2 paliers pour le lancement (voir keyboards.ts).
  const proPlanVisible = env.PRO_PLAN_VISIBLE === "true";

  // Trois écrans courts au lieu d'un pavé : ce qu'on reçoit, ce qui tourne
  // aujourd'hui, puis ce qui pourrait décevoir. Les prix ne viennent qu'après.
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, buildValueScreen());
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, buildCarryScreen());
  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, buildSilenceWarning());

  const lines = [
    "📅 LES OFFRES",
    "",
    `⭐ Standard — ${PLAN_PRICES_USD[1]} USDT pour ${PLAN_DURATION_DAYS[1]} jours`,
    "Tous les signaux des cinq familles, carry compris, au rythme mesuré de 2,99 par jour en moyenne.",
  ];
  if (proPlanVisible) {
    lines.push(
      "",
      `🎯 Pro — ${PLAN_PRICES_USD[2]} USDT pour ${PLAN_DURATION_DAYS[2]} jours`,
      "Les mêmes signaux, mais envoyés en priorité, avant tout le monde."
    );
  }
  if (remainingDiscoverySlots > 0) {
    lines.push(
      "",
      `🚀 Découverte — ${PLAN_PRICES_USD[3]} USDT pour ${PLAN_DURATION_DAYS[3]} jours`,
      `Offre de lancement, ${remainingDiscoverySlots} places restantes, une fois par wallet. ` +
        "C'est le palier fait pour vérifier par toi-même avant de t'engager davantage."
    );
  }
  lines.push(
    "",
    "Aucun prélèvement automatique, aucun engagement : l'abonnement s'arrête tout seul à échéance, " +
      "il n'y a rien à résilier.",
    "",
    "Choisis un plan ci-dessous. Rien n'est payé à ce stade : il reste deux écrans avant le moindre envoi de fonds.",
  );

  // Deux issues ajoutées sous les plans : le guide, et surtout un chemin
  // explicite pour qui n'a aucune crypto. Sans lui, ce visiteur-là n'avait
  // aucune porte de sortie autre que fermer Telegram.
  const keyboard: InlineKeyboard = buildPlanKeyboard(remainingDiscoverySlots, proPlanVisible);
  keyboard.push([{ text: "🧭 Je n'ai jamais acheté de crypto", callback_data: "pay:DEBUTANT:1" }]);
  keyboard.push([{ text: "📖 Guide de paiement complet", callback_data: "pay:guide" }]);

  await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, lines.join("\n"), { keyboard });
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
  // il faut un acte positif avant le paiement.
  //
  // Le deuxième point a été réécrit le 04/08/2026 : il annonçait qu'aucun
  // signal n'est émis sous la moyenne 200 jours, ce que le carry a rendu
  // faux. Ce qu'il doit garantir reste identique — l'abonné sait qu'il achète
  // des jours calendaires et non un nombre de signaux — mais il ne peut pas
  // le garantir en décrivant un moteur qui n'existe plus.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    `Plan ${PLAN_NAMES[plan]} — ${PLAN_PRICES_USD[plan]} USDT pour ${PLAN_DURATION_DAYS[plan]} jours.\n\n` +
      `Quatre points à valider avant de choisir comment payer :\n\n` +
      `• L'accès démarre immédiatement après confirmation du paiement.\n` +
      `• Ton abonnement se compte en jours calendaires, pas en nombre de signaux. Le rythme dépend du ` +
      `marché : 4,35 signaux par jour quand il est favorable, 1,15 quand il ne l'est pas. Un abonnement ` +
      `qui se termine sur une période calme ne donne pas droit à un remboursement.\n` +
      `• Le paiement se fait en cryptoactifs : il est irréversible, et aucun remboursement n'est possible ` +
      `une fois confirmé. En demandant l'exécution immédiate, tu renonces à ton droit de rétractation de 14 jours.\n` +
      `• Aucune performance n'est garantie. Les signaux ne sont pas un conseil en investissement, ` +
      `et tu peux perdre de l'argent.\n\n` +
      `Conditions complètes : ${TERMS_URL}`,
    {
      keyboard: [
        ...consentKeyboard(plan),
        [{ text: "⬅️ Revoir les offres", callback_data: `pay:OFFRES:${plan}` }],
      ],
    }
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

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "💳 PAIEMENT EN 3 ÉTAPES\n\n" +
      "1. Tu me dis d'où partiraient les fonds.\n" +
      "2. Je te donne une adresse et un montant exact.\n" +
      "3. Tu envoies. Ton accès s'ouvre en 2 à 5 minutes, tout seul — rien à me renvoyer, aucun " +
      "justificatif, aucune pièce d'identité.\n\n" +
      "🛡️ Aucun prélèvement automatique, aucun engagement. L'abonnement s'arrête seul à échéance : " +
      "il n'y a rien à résilier."
  );

  // Le choix ne se pose plus en « quelle cryptomonnaie ? » (une question de
  // spécialiste) mais en « d'où partent tes fonds ? » (une question à laquelle
  // n'importe qui sait répondre). Ce n'est pas cosmétique : la réponse change
  // réellement le moyen de paiement qui peut fonctionner. Le rattachement d'un
  // paiement USDT se fait par l'adresse EXPÉDITRICE (voir
  // cron/pollPayments.ts, findUserByWalletAddress) — un retrait fait
  // directement depuis un exchange part donc d'une adresse appartenant à la
  // plateforme, que l'acheteur ne connaît pas et ne peut pas déclarer. Litecoin
  // et Monero, eux, utilisent une adresse dédiée par paiement : l'expéditeur
  // n'a aucune importance. C'est exactement l'inverse de ce que le tunnel
  // recommandait jusqu'ici.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "Une seule question, et je m'occupe du reste : d'où partiraient les fonds ?\n\n" +
      "🏦 De mon compte sur une plateforme (Binance, Coinbase, Kraken...)\n" +
      "→ prends Litecoin. Je te donne une adresse rien que pour toi, tu fais un retrait dessus, " +
      "et je n'ai besoin de rien d'autre. C'est le chemin le plus court quand on n'a pas de wallet personnel.\n\n" +
      "🦊 De mon propre wallet (MetaMask, Trust Wallet, Rabby...)\n" +
      "→ prends USDT sur Polygon. Des frais de réseau de quelques centimes, c'est le moins cher. " +
      "Il me faudra ton adresse 0x avant le paiement, je t'expliquerai pourquoi.\n\n" +
      "🕵️ Je tiens surtout à la confidentialité\n" +
      "→ prends Monero. Un peu plus lent à confirmer, sinon identique.\n\n" +
      "🤷 Je n'ai aucune crypto et je ne sais pas par où commencer\n" +
      "→ dernier bouton. Je t'explique le chemin complet, il est plus court que tu ne crois.",
    {
      keyboard: [
        [{ text: "🏦 Depuis Binance / Coinbase / Kraken → Litecoin", callback_data: `pay:LTC:${plan}` }],
        [{ text: "🦊 Depuis mon wallet → USDT (Polygon)", callback_data: `pay:USDT:${plan}` }],
        [{ text: "🕵️ Confidentialité maximale → Monero", callback_data: `pay:XMR:${plan}` }],
        [{ text: "🤷 Je n'ai aucune crypto", callback_data: `pay:DEBUTANT:${plan}` }],
        [{ text: "📖 Guide de paiement complet", callback_data: "pay:guide" }],
      ],
    }
  );

  // Filet de rassurance : même automatisé, savoir qu'on peut « répondre »
  // lève une hésitation réelle au moment de payer. La durée de validité de
  // l'adresse est annoncée ici plutôt que découverte après coup.
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "❓ Un doute, une fausse manipulation, un paiement qui n'arrive pas ? Réponds simplement à ce message, " +
      "l'administrateur le verra. Et /check_payment te donne à tout moment l'état exact de ta transaction.\n\n" +
      `Une adresse de paiement reste valable ${PAYMENT_ADDRESS_VALID_DAYS} jours. Tant que tu n'as rien envoyé, ` +
      "rien n'est perdu : il suffit de relancer /subscribe. Et si tu envoies après l'expiration, réponds à ce " +
      "message — l'activation se fait alors à la main, tes fonds ne disparaissent pas."
  );
}

/**
 * Écran pour qui part réellement de zéro. C'était le trou le plus visible du
 * tunnel : les trois moyens de paiement supposaient tous qu'on possède déjà
 * des cryptoactifs, et une personne qui n'en a aucun n'avait aucune porte de
 * sortie autre que fermer Telegram.
 */
async function sendBeginnerPath(env: Env, telegramId: number, plan: PaidPlan): Promise<void> {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🧭 TU PARS DE ZÉRO — VOICI LE CHEMIN LE PLUS COURT\n\n" +
      "Trois étapes, aucune ne demande de compétence technique.\n\n" +
      "1. Ouvre un compte sur une plateforme d'échange grand public. Binance, Coinbase et Kraken sont les " +
      "plus utilisées en France. L'ouverture est gratuite. Une pièce d'identité sera demandée : c'est la loi, " +
      "toutes les plateformes légales le font. Compte de quelques minutes à quelques jours de vérification " +
      "selon la plateforme et le moment.\n\n" +
      `2. Dépose de quoi couvrir le plan choisi (${PLAN_PRICES_USD[plan]} USDT pour le plan ` +
      `${PLAN_NAMES[plan]}) par carte ou par virement, puis achète du Litecoin. Prends un tout petit peu ` +
      "plus que le montant demandé : la plateforme prélève des frais de retrait, et le montant doit arriver " +
      "complet chez moi pour que le paiement soit validé.\n\n" +
      "3. Reviens ici, choisis Litecoin, et fais un retrait vers l'adresse que je te donnerai. " +
      "Ton accès s'ouvre tout seul, en quelques minutes.\n\n" +
      "Pourquoi pas de carte bancaire directement ici ? Parce que ce service ne collecte ni identité ni " +
      "coordonnées bancaires, et qu'accepter la carte imposerait les deux. C'est une limite réelle " +
      "aujourd'hui, et on préfère l'écrire que te la faire découvrir au moment de payer.",
    {
      keyboard: [
        [{ text: "⬅️ Revenir au choix du paiement", callback_data: `pay:RETOUR:${plan}` }],
        [{ text: "📖 Guide de paiement complet", callback_data: "pay:guide" }],
      ],
    }
  );
}

/**
 * Efface une attente d'adresse USDT devenue caduque quand l'acheteur change
 * finalement de moyen de paiement. Sans ça, le tout prochain message libre
 * qu'il écrivait (souvent une question) était interprété comme une adresse
 * wallet et se voyait répondre « Adresse invalide » — voir
 * bot/walletAddressHandler.ts. Toute autre attente en cours est remise en
 * place : on ne casse pas un /review commencé ailleurs.
 */
async function clearStaleWalletPrompt(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const pendingAction = await consumePendingAction(db, telegramId);
  if (pendingAction && pendingAction.type !== "awaiting_wallet_usdt") {
    await setPendingAction(db, telegramId, pendingAction);
  }
}

/** data au format "pay:USDT:1", "pay:XMR:2", "pay:LTC:3", ou pseudo-méthode d'aiguillage ("pay:DEBUTANT:1"). */
export async function handlePaymentMethodSelection(env: Env, telegramId: number, data: string): Promise<void> {
  const [, methodRaw, planRaw] = data.split(":");
  const method = methodRaw as "USDT" | "XMR" | "LTC" | "DEBUTANT" | "RETOUR" | "OFFRES";
  const rawPlan = Number(planRaw);
  if (!isValidPlan(rawPlan)) return;
  const plan: PaidPlan = rawPlan;
  const db = dbConfig(env);

  // Écrans d'aiguillage transportés par le même préfixe "pay:" que les moyens
  // de paiement : le routeur (bot/router.ts) reste inchangé, et une
  // pseudo-méthode ne peut pas être confondue avec USDT/XMR/LTC. Ils rendent
  // le tunnel réversible — jusqu'ici, une personne qui se rendait compte au
  // dernier écran qu'elle s'était trompée devait deviner /subscribe.
  if (method === "DEBUTANT") {
    await clearStaleWalletPrompt(env, telegramId);
    await sendBeginnerPath(env, telegramId, plan);
    return;
  }
  if (method === "RETOUR") {
    await clearStaleWalletPrompt(env, telegramId);
    await handlePurchaseConsent(env, telegramId, `consent:${plan}`);
    return;
  }
  if (method === "OFFRES") {
    await clearStaleWalletPrompt(env, telegramId);
    await handleSubscribeCommand(env, telegramId);
    return;
  }

  // Contrôle des places Découverte remonté AVANT l'aiguillage par méthode :
  // il n'était fait que pour XMR/LTC ici, et côté USDT seulement à l'intérieur
  // de startUsdtPayment, une fois l'adresse saisie. Un acheteur pouvait donc
  // traverser tout le tunnel pour se voir refuser à la toute dernière étape.
  if (plan === DISCOVERY_PLAN) {
    const remaining = await getRemainingDiscoverySlots(db);
    if (remaining <= 0) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, telegramId, "⚠️ Le Pack Découverte est épuisé. Choisis Standard ou Pro avec /subscribe.");
      return;
    }
  }

  const priceUsd = await getEffectivePriceUsd(db, telegramId, PLAN_PRICES_USD[plan]);

  if (method === "USDT") {
    await setPendingAction(db, telegramId, { type: "awaiting_wallet_usdt", plan });
    // La demande tenait en une phrase (« envoie-moi l'adresse depuis laquelle
    // tu vas payer »), sans dire à quoi elle sert, où la trouver, ni surtout
    // qu'un retrait fait directement depuis un exchange rend le rattachement
    // impossible. C'était l'étape la plus abandonnable du tunnel, et le
    // « chemin le plus simple » qu'on mettait en avant partout était
    // précisément celui qui ne pouvait pas fonctionner depuis un exchange.
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      "🦊 USDT SUR POLYGON — UNE CHOSE À FAIRE AVANT DE PAYER\n\n" +
        `Montant : ${priceUsd} USDT. Frais de réseau : quelques centimes.\n\n` +
        "Pour créditer ton abonnement tout seul, je dois reconnaître ta transaction parmi toutes celles qui " +
        "arrivent. Sur Polygon, je le fais grâce à l'adresse qui ENVOIE les fonds. J'ai donc besoin de la " +
        "tienne avant que tu paies.\n\n" +
        "Envoie-la moi ici en un message : elle commence par 0x et fait 42 caractères. Dans MetaMask, Trust " +
        "Wallet ou Rabby, elle est affichée en haut de l'écran, et un clic dessus la copie.\n\n" +
        "⚠️ Ça ne fonctionne que si tu paies depuis TON wallet.\n" +
        "Si tu comptes retirer directement depuis Binance, Coinbase ou Kraken vers mon adresse, l'expéditeur " +
        "sera la plateforme et non toi : je ne pourrai pas rattacher le paiement à ton compte. Dans ce cas, " +
        "prends Litecoin avec le bouton ci-dessous — l'adresse y est dédiée à ton paiement, et l'expéditeur " +
        "n'a alors aucune importance.\n\n" +
        "🔒 Je ne te demanderai jamais ta clé privée ni ta phrase de récupération. Une adresse publique 0x ne " +
        "permet à personne de toucher à tes fonds.",
      {
        keyboard: [
          [{ text: "🏦 Finalement je paie depuis ma plateforme → Litecoin", callback_data: `pay:LTC:${plan}` }],
          [{ text: "⬅️ Autre moyen de paiement", callback_data: `pay:RETOUR:${plan}` }],
        ],
      }
    );
    return;
  }

  // À partir d'ici l'acheteur ne passera plus par la saisie d'adresse : on
  // efface l'attente éventuelle laissée par un aller-retour côté USDT.
  await clearStaleWalletPrompt(env, telegramId);

  if (method === "XMR") {
    // Le wallet Monero tourne sur une machine de l'administrateur (monero-wallet-rpc
    // + ngrok, voir payments/monero.ts) : quand elle est éteinte, createMoneroInvoice
    // lève, et le filet du routeur affichait « Une erreur temporaire est survenue »,
    // sans issue ni explication. On nomme la panne et on rouvre les deux autres
    // chemins, qui eux ne dépendent d'aucune machine allumée.
    if (!(await isWalletRpcAvailable(env))) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        telegramId,
        "🟠 Le paiement Monero est momentanément indisponible de notre côté — ce n'est pas un problème chez " +
          "toi, et rien n'a été débité. Litecoin et USDT restent ouverts et fonctionnent normalement.",
        { keyboard: [[{ text: "⬅️ Choisir un autre moyen de paiement", callback_data: `pay:RETOUR:${plan}` }]] }
      );
      return;
    }

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
    // Message d'adresse volontairement court et en Markdown (les backticks
    // rendent l'adresse copiable d'un clic) ; tout le texte explicatif part
    // dans un second message SANS parse_mode, pour qu'un caractère malheureux
    // ne puisse jamais faire tomber le message qui porte l'adresse.
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      telegramId,
      `🟠 *Paiement Monero — ${PLAN_NAMES[plan]}*\n\n` +
        `Montant exact : *${invoice.amountXmr.toFixed(6)} XMR*\n` +
        `Adresse (à usage unique, générée pour toi) :\n` +
        `\`${invoice.address}\``,
      { markdown: true }
    );
    // Nombre de confirmations lu dans l'environnement (checkMoneroPayment
    // utilise la même valeur) plutôt qu'un délai en minutes écrit à la main,
    // qui deviendrait faux au premier changement de réglage.
    await sendMonoStepReassurance(env, telegramId, `${env.MONERO_MIN_CONFIRMATIONS} confirmations sur la blockchain Monero`);
    return;
  }

  if (method === "LTC") {
    const invoice = await createLitecoinInvoice(db, telegramId, priceUsd);
    if (!invoice) {
      await sendMessage(
        env.TELEGRAM_BOT_TOKEN,
        telegramId,
        "⚠️ Le pool d'adresses Litecoin est momentanément épuisé — rien n'a été débité. Choisis USDT ou " +
          "Monero, ou réessaie dans quelques instants.",
        { keyboard: [[{ text: "⬅️ Choisir un autre moyen de paiement", callback_data: `pay:RETOUR:${plan}` }]] }
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
        `Montant exact : *${invoice.amountLtc.toFixed(6)} LTC*\n` +
        `Adresse (à usage unique, générée pour toi) :\n` +
        `\`${invoice.address}\`\n\n` +
        `📱 [Ouvrir directement dans ton wallet](${ltcUri}) — adresse et montant préremplis.`,
      { markdown: true }
    );
    await sendMonoStepReassurance(env, telegramId, "quelques minutes");
  }
}

/**
 * Bloc de réassurance commun aux paiements par adresse dédiée (LTC/XMR),
 * envoyé juste après l'adresse. Il répond aux trois questions que se pose
 * quelqu'un qui a le doigt sur le bouton « Retirer » de son exchange, et
 * qu'aucun écran ne traitait : et si le montant n'est pas exact, combien de
 * temps ça prend, et que faire si rien ne se passe.
 *
 * Envoyé sans parse_mode (parenthèses, tirets, slashs de commandes).
 */
async function sendMonoStepReassurance(env: Env, telegramId: number, confirmationDelay: string): Promise<void> {
  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "Trois choses utiles avant d'appuyer sur « Retirer » :\n\n" +
      "• Le montant doit ARRIVER complet. La plupart des plateformes prélèvent des frais de retrait sur la " +
      "somme envoyée : demande un retrait légèrement supérieur pour que le montant reçu corresponde. " +
      "Si tu envoies un peu plus, c'est sans conséquence — le surplus est simplement conservé.\n" +
      "• Cette adresse est unique et n'est utilisée que pour ton paiement. Peu importe d'où partent les " +
      `fonds. Confirmation attendue : ${confirmationDelay}, puis ton accès s'ouvre en 2 à 5 minutes, tout seul.\n` +
      `• L'adresse reste valable ${PAYMENT_ADDRESS_VALID_DAYS} jours. Tu peux la revoir à tout moment avec /pay, ` +
      "et suivre l'état de ta transaction avec /check_payment.\n\n" +
      "Si quelque chose ne se passe pas comme prévu, réponds simplement à ce message : l'administrateur le verra."
  );
}
