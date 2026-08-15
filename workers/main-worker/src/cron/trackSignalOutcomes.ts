/**
 * Bloc 4 : suivi automatique des signaux après leur envoi.
 *   1. Vérifie le prix courant (Binance) de chaque signal encore ouvert.
 *   2. Le clôture dès que le take profit ou le stop loss est atteint, ou à
 *      son échéance sans avoir touché ni l'un ni l'autre. Le verdict d'une
 *      échéance suit alors le RÉSULTAT — gagnant si TP1 avait été sécurisé ou
 *      si le rendement final est positif — exactement comme la convention
 *      écrite dans signals/backtest.py::_simulate_multi_tp_exit. La règle
 *      appliquée ici était plus sévère que celle-là, et publiait « perdant »
 *      sur des trades sortis en gain.
 *   3. Notifie en DM chaque destinataire réel du signal (signal_deliveries,
 *      pas "tous les actifs au moment de la clôture" — un utilisateur peut
 *      avoir changé de plan entre-temps).
 *   4. Célèbre publiquement les victoires (et annonce calmement les pertes,
 *      sans les cacher) sur le canal public, UNIQUEMENT si ce signal y a
 *      lui-même été diffusé (sent_to_channel) — sinon l'audience du canal
 *      n'a jamais vu l'ouverture et un message de clôture serait confus.
 *
 * Limite assumée (identique à website/outcome_evaluator.py) : comparaison au
 * prix COURANT, pas à l'historique intrabar complet.
 */

import { Env, dbConfig } from "../env";
import { getOpenSignals, markSignalClosed, updateTrailingStop, markTp1Hit, markTp2Hit, SignalRecord, PROJECTION_SIGNAL_COMPLET } from "../db/signals";
import { getDeliveryRecipients } from "../db/signalDeliveries";
import { filterByPrefEnabled } from "../db/userPrefs";
import { getCurrentPrices, pairToSymbol } from "../market/binancePrices";
import { evaluateOutcome, computePnlPct, computeTrailingStop, evaluateMultiTpProgress, pnlEffectif, CloseReason } from "../signalMath";
import { sendMessage } from "../telegram";
import { handleAntiStress } from "./antiStress";
import { typeLabel, prix } from "../signalFormat";
import { buildReferralLink, REFERRAL_BONUS_DAYS } from "../bot/referral";
import { peutPublier, enregistrerEnvoi } from "../channelBudget";
import { selectRows } from "../supabaseRest";
import { isQuietHours } from "../utils/quietHours";

// Filet de sécurité, utilisé UNIQUEMENT quand le signal ne porte pas sa propre
// échéance (signaux antérieurs à hold_until). Voir holdDeadlineMs ci-dessous :
// chaque moteur a été validé sur SA durée de détention, pas sur celle-ci.
const SIGNAL_TIMEOUT_DAYS = 10;
const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1200;

/**
 * Instant de clôture temporelle d'un signal.
 *
 * Chaque moteur a été mesuré avec une sortie temporelle qui lui est propre :
 * 7 jours pour la force relative, 3 jours pour le momentum 4 h. Les tenir tous
 * 10 jours ne serait PAS la stratégie validée — et l'écart n'est pas anodin :
 * le momentum 4 h ne travaille qu'en marché baissier, précisément le régime où
 * garder une position longue trois fois trop longtemps efface le gain mesuré.
 *
 * On lit donc l'échéance portée par le signal lui-même, et on ne retombe sur
 * la constante que pour les signaux émis avant l'introduction de la colonne.
 */
function holdDeadlineMs(signal: SignalRecord): number {
  if (signal.hold_until) {
    const echeance = new Date(signal.hold_until).getTime();
    if (Number.isFinite(echeance)) return echeance;
  }
  return new Date(signal.created_at).getTime() + SIGNAL_TIMEOUT_DAYS * 24 * 60 * 60 * 1000;
}

/** Durée de détention prévue, en jours, pour l'annoncer telle qu'elle a été tenue. */
function holdDurationDays(signal: SignalRecord): number {
  const jours = (holdDeadlineMs(signal) - new Date(signal.created_at).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(1, Math.round(jours));
}

/**
 * Jours RÉELLEMENT écoulés depuis l'émission, distinct de holdDurationDays qui
 * rend la durée PRÉVUE.
 *
 * La différence compte : un signal de 7 jours clôturé sur objectif au deuxième
 * jour annoncerait « les abonnés l'avaient il y a 7 jours », ce qui serait
 * faux. On mesure donc l'écart réel jusqu'à maintenant — cette fonction n'est
 * appelée qu'au moment de la clôture.
 */
function joursDepuisEmission(signal: SignalRecord, maintenant = Date.now()): number {
  const jours = (maintenant - new Date(signal.created_at).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(1, Math.round(jours));
}

/**
 * Pourcentage au format FRANÇAIS, comme partout ailleurs dans le produit.
 *
 * Cette fonction écrivait « -2.6% » : point décimal anglais, sans espace avant
 * le signe. Le canal public a donc publié le 10/08, à quelques lignes d'écart
 * dans le même message :
 *
 *   ACHAT ADA/USDT — sortie à 0.1962 (-2.6%)
 *   🛑 Stop : 0.1785 (-6,2 %)
 *
 * Deux conventions typographiques pour la même grandeur, sous les yeux du même
 * lecteur. C'est un détail, et c'est exactement le genre de détail qui fait
 * amateur sur un produit dont l'argument central est la rigueur de la mesure —
 * sur la ligne la plus lue du message, celle qui annonce le résultat.
 *
 * Le PRIX garde son point décimal (voir signalFormat.ts::prix) parce qu'il est
 * fait pour être recopié dans une plateforme d'échange. Un pourcentage ne se
 * recopie nulle part : il se lit, en français.
 */
function pctLabel(pct: number): string {
  const signe = pct >= 0 ? "+" : "";
  return `${signe}${pct.toFixed(1).replace(".", ",")} %`;
}

function formatSubscriberCloseMessage(signal: SignalRecord, pct: number): string {
  const base = `${typeLabel(signal.type)} ${signal.pair} — entrée ${prix(signal.entry_price)}, clôturé à ${prix(signal.outcome_price ?? 0)} (${pctLabel(pct)}).`;

  // Mission "grille d'excellence" : un signal peut se clôturer à 0% après
  // avoir déjà sécurisé TP1 (retour au break-even) ou sur le runner TP3 —
  // deux cas que le message générique "Take profit atteint" rendait confus
  // (0.0% affiché à côté d'un "take profit atteint", ou TP3 traité comme un
  // gain quelconque sans reconnaître le runner).
  const isTp3Win = signal.close_reason === "tp_hit" && signal.tp3_price != null && signal.outcome_price === signal.tp3_price;
  if (isTp3Win) {
    return ["🥉 *TP3 atteint — le runner est allé au bout !* 🚀", base].join("\n");
  }
  const isBreakevenAfterTp1 = signal.close_reason === "tp_hit" && signal.tp1_hit_at != null && signal.outcome_price === signal.entry_price;
  if (isBreakevenAfterTp1) {
    return [
      "🔒 *Clôturé au point mort — TP1 déjà sécurisé*",
      base,
      "Le prix est revenu à l'entrée après ton premier objectif : le gain de TP1 reste acquis, ce trade compte comme un succès.",
    ].join("\n");
  }

  switch (signal.close_reason) {
    case "tp_hit":
      return [`✅ *Take profit atteint*`, base].join("\n");
    case "sl_hit":
      return [
        `❌ *Stop loss touché*`,
        base,
        "La gestion du risque fait partie de la stratégie : le stop loss limite la perte à un niveau connu à l'avance.",
      ].join("\n");
    default:
      // Le titre et la phrase suivent le RÉSULTAT, pas seulement le motif.
      // Une échéance ayant touché TP1 en cours de route n'est pas « sans avoir
      // atteint son objectif » : 30 % de la position en sont sortis, et le stop
      // était remonté au point mort. Le dire faux ici aurait le même effet que
      // sur le canal public — l'abonné compare les nombres qu'on lui a donnés.
      return [
        signal.outcome === "WIN" ? `⌛ *Clôturé à l'échéance — en gain*` : `⌛ *Clôturé à l'échéance*`,
        `${base} ${causeDeCloture(signal)}`,
        "La sortie au bout d'une durée fixe fait partie de la stratégie : c'est ainsi qu'elle a été mesurée.",
      ].join("\n");
  }
}

/**
 * Clôture sur le canal PUBLIC : le signal entier, cette fois.
 *
 * C'est la contrepartie du format d'annonce sans niveaux (voir
 * signalFormat.buildPublicTeaserMessage). À l'ouverture, le canal gratuit
 * apprend qu'un signal part et de quel moteur ; à la clôture, il reçoit TOUT —
 * les niveaux qui avaient été réservés, le résultat, et le pourcentage.
 *
 * Sans ces niveaux ici, le relevé public serait invérifiable : « ce signal a
 * gagné 4 % » ne veut rien dire si l'on ne sait ni où il entrait ni où il
 * s'arrêtait. Les publier après coup ne coûte rien — le trade est terminé — et
 * c'est ce qui transforme une affirmation en démonstration.
 *
 * Les pertes sont publiées exactement au même endroit, dans le même format, et
 * sans adoucissement. Un canal qui ne montrerait que ses gains ne prouverait
 * rien du tout.
 */
/**
 * LA CAUSE DE LA CLÔTURE, dite exactement.
 *
 * « Objectif atteint. » partait dès que close_reason valait « tp_hit ». Or ce
 * motif était posé sur toute échéance ayant touché TP1 en cours de route — et
 * le canal public a donc publié le 12/08/2026 :
 *
 *   ✅ Signal clôturé — gagnant
 *   ACHAT ICP/USDT — sortie à 2.238
 *   🥇 TP1 : 2.3356
 *   Objectif atteint.
 *
 * Trois nombres et une phrase dans le même message, et n'importe quel lecteur
 * peut voir que 2,238 est INFÉRIEUR à l'objectif annoncé. Sur un canal dont la
 * fonction est de prouver que le relevé est honnête, se faire prendre sur une
 * soustraction coûte plus cher que la perte qu'on essayait d'habiller.
 *
 * Un TP1 touché puis rendu reste une information utile — c'est ce qui a
 * sécurisé la position au point mort. Elle est donc dite, mais dite juste.
 */
function causeDeCloture(signal: SignalRecord): string {
  if (signal.close_reason === "tp_hit") return "Objectif atteint.";
  if (signal.close_reason === "sl_hit") {
    return "Stop loss touché. La perte était bornée à l'avance — c'est à ça que sert un stop.";
  }

  const jours = holdDurationDays(signal);
  if (signal.tp1_hit_at) {
    return (
      `Clôturé à l'échéance, ${jours} jours après l'ouverture. Le premier objectif avait été touché ` +
      "en cours de route : 30 % de la position en sont sortis et le stop était remonté au point mort, " +
      "si bien que ce signal ne pouvait plus finir perdant. Le reste est sorti au prix du jour."
    );
  }
  return `Clôturé à l'échéance, ${jours} jours après l'ouverture, sans avoir touché ni l'objectif ni le stop.`;
}

function formatPublicCloseMessage(signal: SignalRecord, pct: number, botUsername: string): string {
  const escapedUsername = botUsername.replace(/_/g, "\\_");
  const gagnant = signal.outcome === "WIN";
  const titre = gagnant ? "✅ *Signal clôturé — gagnant*" : "❌ *Signal clôturé — perdant*";

  const niveaux: string[] = [`💵 Entrée : ${prix(signal.entry_price)}`];
  if (signal.stop_loss != null) niveaux.push(`🛑 Stop : ${prix(signal.stop_loss as number)}`);
  if (signal.tp1_price != null) niveaux.push(`🥇 TP1 : ${prix(signal.tp1_price as number)}`);
  if (signal.tp2_price != null) niveaux.push(`🥈 TP2 : ${prix(signal.tp2_price as number)}`);
  if (signal.tp3_price != null) niveaux.push(`🥉 TP3 : ${prix(signal.tp3_price as number)}`);

  const cause = causeDeCloture(signal);

  return [
    titre,
    `${typeLabel(signal.type)} *${signal.pair}* — sortie à ${prix(signal.outcome_price ?? 0)} (*${pctLabel(pct)}*)`,
    "",
    "_Les niveaux tels qu'ils avaient été envoyés aux abonnés :_",
    ...niveaux,
    "",
    cause,
    "",
    // L'ASYMÉTRIE, ÉNONCÉE PLUTÔT QUE SUGGÉRÉE.
    //
    // Le message publiait déjà les niveaux d'origine, mais sans jamais dire
    // QUAND les abonnés les avaient reçus. Un lecteur du canal gratuit voyait
    // donc des chiffres sans comprendre qu'il les découvrait avec plusieurs
    // jours de retard — c'est-à-dire sans comprendre ce qu'il n'a pas.
    //
    // Cette différence de calendrier EST le produit : le canal gratuit reçoit
    // tout, mais après. Le dire au moment exact où la preuve est sous les yeux
    // est plus convaincant que n'importe quel argument de vente, et c'est
    // strictement vrai.
    `⏱️ Les abonnés avaient ces niveaux il y a ${joursDepuisEmission(signal)} jour(s), au moment où le ` +
      "signal est parti. C'est la seule chose qui sépare ce canal d'un abonnement.",
    "",
    "📊 Chaque signal est republié ici à sa clôture, gagnant ou perdant, avec ses niveaux d'origine. " +
      "Rien n'est retiré après coup.",
    "",
    `🎁 Pour les recevoir au moment où ils partent : @${escapedUsername} — essai gratuit de 3 jours.`,
  ].join("\n");
}

function formatTrailingStopUpdate(signal: SignalRecord, newTrailingStop: number): string {
  const previous = signal.trailing_stop_price ?? signal.stop_loss;
  const direction = signal.type === "BUY" ? "remonte" : "baisse";
  return [
    "🔒 *Trailing stop* — mets à jour ton stop",
    // Ces deux prix sortaient bruts : l'abonné a lu « remonte ton stop de
    // 579.6211377 à 599.23 » le 12/08/2026, et « de 1.3215258 à 1.4 » le 13/08.
    // Ce message demande une SAISIE sur une plateforme d'échange : c'est
    // précisément celui où un nombre à sept décimales fait le plus de dégâts.
    `${typeLabel(signal.type)} ${signal.pair} progresse en ta faveur : ${direction} ton stop de ${prix(previous as number)} à ${prix(newTrailingStop)} pour sécuriser une partie du gain.`,
    "Purement indicatif — n'affecte pas le stop loss officiel de ce signal.",
  ].join("\n");
}

function formatTp1HitMessage(signal: SignalRecord): string {
  return [
    "🥇 *TP1 sécurisé !*",
    `${typeLabel(signal.type)} ${signal.pair} a atteint son premier objectif (${prix(signal.tp1_price as number)}).`,
    `${signal.stop_loss !== signal.entry_price ? "Le stop passe automatiquement au break-even (prix d'entrée)" : "Stop déjà au break-even"} — ce signal ne peut plus finir perdant.`,
    `Objectif suivant : TP2 (${prix(signal.tp2_price as number)}).`,
  ].join("\n");
}

function formatTp2HitMessage(signal: SignalRecord): string {
  return [
    "🥈 *TP2 atteint — objectif principal !*",
    `${typeLabel(signal.type)} ${signal.pair} a atteint son objectif principal (${prix(signal.tp2_price as number)}).`,
    `Le reste de la position vise maintenant le runner TP3 (${prix(signal.tp3_price as number)}), stop toujours au break-even.`,
  ].join("\n");
}

/**
 * Message festif du canal VIP quand TP2 ou TP3 est atteint.
 *
 * Le rappel du parrainage est en deuxième ligne, court, et jamais à la place de
 * la nouvelle. Ce canal est lu par des abonnés payants : c'est exactement le
 * public qui peut recommander le produit, et le seul instant où il en a envie.
 */
function formatCelebrationMessage(signal: SignalRecord, level: "TP2" | "TP3", pct: number): string {
  const medal = level === "TP2" ? "🥈" : "🥉";
  return [
    `${medal} *${level} ATTEINT sur ${signal.pair} !* ${pctLabel(pct)} sécurisés. Félicitations aux abonnés !`,
    `🤝 Envie d'en parler ? /referral te donne ton lien : ${REFERRAL_BONUS_DAYS} jours offerts par personne qui s'abonne.`,
  ].join("\n");
}

/**
 * Texte que l'abonné peut copier-coller sur ses réseaux, PORTANT SON PROPRE
 * LIEN DE PARRAINAGE.
 *
 * Il n'en portait aucun : on demandait à quelqu'un qui vient de gagner de faire
 * la promotion du produit, et on ne lui en rendait rien. Avec son lien, le même
 * partage lui rapporte REFERRAL_BONUS_DAYS jours d'accès par personne qui
 * s'abonne, et donne une remise à celle qui clique.
 *
 * C'est aussi le seul moment du parcours où la demande est naturelle : juste
 * après une victoire, sur un message qu'il a envie de montrer. Proposé à froid,
 * le parrainage se lit comme une sollicitation ; proposé ici, comme une occasion.
 */
function formatShareableVictory(signal: SignalRecord, pct: number, env: Env, telegramId: number): string {
  const lien = buildReferralLink(env, telegramId);
  return [
    "📣 *À partager si tu veux — avec TON lien :*",
    `\`🎯 ${pctLabel(pct)} sur ${signal.pair} ! Signaux crypto mesurés sur 6 ans, essai gratuit de 3 jours : ${lien}\``,
    "",
    `🤝 Chaque personne qui s'abonne via ce lien t'offre ${REFERRAL_BONUS_DAYS} jours d'accès, et lui donne une remise. Ton suivi complet : /referral`,
  ].join("\n");
}

/**
 * Le bloc de partage, joint à TOUTE clôture gagnante — et à aucune perdante.
 *
 * Il n'était attaché qu'aux clôtures TP3. Or TP3 est le cas le plus rare du
 * produit : un gain sur TP1, sur TP2, ou à l'échéance après sécurisation
 * n'entraînait aucune proposition de parrainage. La grande majorité des bonnes
 * nouvelles passait donc sans que le seul avantage réel dont dispose l'abonné —
 * +{REFERRAL_BONUS_DAYS} jours par filleul payant — lui soit rappelé.
 *
 * Le moment fait tout : proposé à froid, le parrainage se lit comme une
 * sollicitation ; proposé sur un message qu'on a envie de montrer, comme une
 * occasion. C'est exactement pour ça qu'il ne doit JAMAIS accompagner une
 * perte : demander de partager un trade perdant serait absurde, et le rappel
 * du bonus au pire moment se lit comme de l'indécence.
 *
 * Retourne `undefined` sur une perte, ce que closeSignal interprète comme
 * « pas de supplément » — le message de clôture part alors inchangé.
 */
function partageSiGagnant(
  env: Env,
  signal: SignalRecord,
  resultat: { outcome: "WIN" | "LOSS"; exitPrice: number | null }
): ((telegramId: number) => string) | undefined {
  if (resultat.outcome !== "WIN" || resultat.exitPrice === null) return undefined;
  // Le texte partageable voyage DANS le message de clôture : deux calculs
  // différents y afficheraient deux pourcentages différents pour le même
  // trade, à trois lignes d'écart. Le 15/08, LINK est parti en « +9,3 % » dans
  // la clôture et « +10,8 % » dans le bloc de partage juste en dessous.
  const pct = pnlEffectif(signal, resultat.exitPrice);
  return (telegramId: number) => formatShareableVictory(signal, pct, env, telegramId);
}

async function broadcastCelebration(env: Env, signal: SignalRecord, level: "TP2" | "TP3", pct: number): Promise<void> {
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;
  const channelId = Number(env.TELEGRAM_VIP_CHANNEL_ID);

  // Le régulateur décide du MOMENT, jamais du contenu. La catégorie
  // « resultat » ignore le plafond quotidien — une preuve du produit ne doit
  // jamais être retenue — mais respecte l'espacement minimal. Sans lui, cinq
  // positions franchissant TP2 dans le même cycle produisaient cinq messages
  // en quelques secondes, ce qui se lit comme du spam même quand c'est une
  // bonne nouvelle.
  const db = dbConfig(env);
  const verdict = await peutPublier(db, "vip", "resultat");
  if (!verdict.autorise) return;

  await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatCelebrationMessage(signal, level, pct), { markdown: true }).catch((err) =>
    console.error(`[post-trade] Échec de la célébration VIP pour le signal #${signal.id} (${level}):`, err)
  );
  await enregistrerEnvoi(db, "vip", "resultat", `tp:${signal.id}:${level}`);
}

async function closeSignal(
  env: Env,
  db: ReturnType<typeof dbConfig>,
  signal: SignalRecord,
  outcome: "WIN" | "LOSS",
  outcomePrice: number | null,
  closeReason: CloseReason,
  /** Texte personnalisé ajouté au message de clôture, par destinataire. */
  supplement?: (telegramId: number) => string,
  /**
   * Une célébration VIP vient-elle de partir pour CE MÊME événement ?
   *
   * Une clôture sur TP3 déclenche déjà « 🥉 TP3 ATTEINT » sur le canal VIP.
   * Y ajouter « Position clôturée — en gain » ferait deux notifications pour
   * un seul fait, à une seconde d'intervalle — précisément ce que ce module a
   * déjà corrigé ailleurs (voir le TP2, dont l'annonce et le texte partageable
   * ont été fusionnés pour cette raison).
   */
  dejaCelebreEnVip = false
): Promise<void> {
  await markSignalClosed(db, signal.id, { outcome, outcomePrice, closeReason });

  const closedSignal: SignalRecord = { ...signal, outcome, outcome_price: outcomePrice, close_reason: closeReason };
  // Sorties partielles comprises : voir pnlEffectif. Le calcul précédent
  // ignorait les 30 % vendus à TP1 et les 30 % vendus à TP2.
  const pct = pnlEffectif(closedSignal, outcomePrice);

  const recipients = await getDeliveryRecipients(db, signal.id);
  const messageCloture = formatSubscriberCloseMessage(closedSignal, pct);
  if (supplement) {
    await notifyEachRecipient(env, recipients, (id) => `${messageCloture}\n\n${supplement(id)}`);
  } else {
    await notifyRecipients(env, recipients, messageCloture);
  }
  await handleAntiStress(env, recipients, outcome).catch((err) =>
    console.error(`[post-trade] Échec du mécanisme anti-stress pour le signal #${signal.id}:`, err)
  );

  // LE CANAL PAYANT D'ABORD. C'est l'ordre que l'abonnement vend.
  if (!dejaCelebreEnVip) {
    await publierClotureVip(env, db, closedSignal, pct);
  }

  // LES HEURES CALMES S'APPLIQUENT AUSSI AUX CLÔTURES.
  //
  // Ce chemin ne les consultait pas — seul dispatchPublicChannel le faisait —
  // et le canal public a donc publié le 12/08/2026 à 04 h 25 et 04 h 50, puis
  // le 13/08 à 04 h 30. Trois notifications nocturnes sur un canal gratuit dont
  // le seuil de tolérance est le plus bas de tout le produit : c'est ainsi
  // qu'on se fait couper les notifications, puis quitter.
  //
  // Différer était auparavant DANGEREUX ici, parce qu'un report équivalait à
  // une suppression définitive : markSignalClosed s'exécute avant, le signal ne
  // repasse jamais dans la boucle des ouverts, et la clôture #26 a été perdue
  // pour cette raison exacte. Le rattrapage (republierCloturesManquees) a levé
  // cet obstacle : une clôture non publiée est désormais reprise au passage
  // suivant. Le report est donc redevenu ce qu'il aurait toujours dû être —
  // une attente, pas une perte.
  if (signal.sent_to_channel && env.TELEGRAM_CHANNEL_ID && !isQuietHours()) {
    const channelId = Number(env.TELEGRAM_CHANNEL_ID);
    // Même règle que la célébration VIP : espacé, jamais plafonné. La
    // republication d'un signal à sa clôture est ce que le canal gratuit promet
    // dans sa description — elle ne peut pas être supprimée, seulement différée.
    const verdictPublic = await peutPublier(db, "public", "resultat");
    if (verdictPublic.autorise) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, channelId, formatPublicCloseMessage(closedSignal, pct, env.TELEGRAM_BOT_USERNAME), {
        markdown: true,
      }).catch((err) => console.error(`[post-trade] Échec de la célébration publique pour le signal #${signal.id}:`, err));
      await enregistrerEnvoi(db, "public", "resultat", `cloture:${signal.id}`);
    }
  }
}

/**
 * LA CLÔTURE VA AUSSI SUR LE CANAL PAYANT — et l'inverse était une inversion
 * complète de la valeur du produit.
 *
 * Comptage réel de `channel_posts` sur cinq jours :
 *
 *   09/08  public 6 messages  |  VIP 2
 *   10/08  public 7           |  VIP 1
 *   11/08  public 7           |  VIP 1
 *   12/08  public 8           |  VIP 1
 *   13/08  public 5           |  VIP 1
 *
 * Le canal GRATUIT recevait cinq à huit messages par jour, dont les clôtures
 * complètes avec tous les niveaux. Le canal PAYANT en recevait un : le
 * briefing. Quelqu'un qui paie rejoignait donc un espace presque vide et
 * apprenait le résultat de SES propres positions sur le canal des gens qui ne
 * paient pas.
 *
 * Ce n'est pas un problème de volume mais d'ordre : le canal payant reçoit
 * désormais la clôture EN PREMIER, ce qui est exactement ce que l'abonnement
 * vend — l'avance. Le message y est aussi plus direct : pas de bloc « voici ce
 * que vous n'avez pas », qui n'a de sens que pour un lecteur gratuit.
 *
 * Aucun contenu n'a été inventé pour remplir : c'est le même événement, envoyé
 * là où il compte le plus.
 */
async function publierClotureVip(
  env: Env,
  db: ReturnType<typeof dbConfig>,
  signal: SignalRecord,
  pct: number
): Promise<void> {
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;
  if (isQuietHours()) return;

  const verdict = await peutPublier(db, "vip", "resultat");
  if (!verdict.autorise) return;

  const gagnant = signal.outcome === "WIN";
  const texte = [
    gagnant ? "✅ *Position clôturée — en gain*" : "❌ *Position clôturée — en perte*",
    `${typeLabel(signal.type)} *${signal.pair}* — entrée ${prix(signal.entry_price)}, sortie ${prix(signal.outcome_price ?? 0)} (*${pctLabel(pct)}*)`,
    "",
    causeDeCloture(signal),
    "",
    "_Rendement sorties partielles comprises. État du portefeuille suivi, pas une prévision._",
  ].join("\n");

  try {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.TELEGRAM_VIP_CHANNEL_ID), texte, { markdown: true });
    await enregistrerEnvoi(db, "vip", "resultat", `cloture:${signal.id}`);
  } catch (err) {
    console.error(`[post-trade] Clôture VIP impossible pour le signal #${signal.id} :`, err);
  }
}

/**
 * Comme notifyRecipients, mais le texte est CONSTRUIT PAR DESTINATAIRE.
 *
 * Nécessaire dès qu'un message contient quelque chose de personnel — ici le
 * lien de parrainage. Même découpage en lots et même traitement des erreurs :
 * un envoi qui échoue ne doit jamais interrompre les autres.
 */
async function notifyEachRecipient(env: Env, telegramIds: number[], build: (id: number) => string): Promise<void> {
  for (let i = 0; i < telegramIds.length; i += BATCH_SIZE) {
    const batch = telegramIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((id) =>
        sendMessage(env.TELEGRAM_BOT_TOKEN, id, build(id), { markdown: true }).catch((err) =>
          console.error(`[post-trade] Échec de notification à ${id}:`, err)
        )
      )
    );
    if (i + BATCH_SIZE < telegramIds.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_BATCHES_MS));
    }
  }
}

async function notifyRecipients(env: Env, telegramIds: number[], text: string): Promise<void> {
  for (let i = 0; i < telegramIds.length; i += BATCH_SIZE) {
    const batch = telegramIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map((id) =>
        sendMessage(env.TELEGRAM_BOT_TOKEN, id, text, { markdown: true }).catch((err) =>
          console.error(`[post-trade] Échec de notification à ${id}:`, err)
        )
      )
    );
    if (i + BATCH_SIZE < telegramIds.length) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }
}

/** Fenêtre de rattrapage des clôtures publiques non parties. */
const JOURS_RATTRAPAGE_CLOTURES = 4;

/**
 * Republie les clôtures que le régulateur avait refusées — et qui, sans ça,
 * étaient perdues pour toujours.
 *
 * LE DÉFAUT QUE CETTE FONCTION RÉPARE, ET QUI VENAIT D'UN CORRECTIF.
 *
 * L'espacement minimal a été appliqué aux clôtures le 09/08 pour éviter les
 * rafales. Mais `closeSignal` marque le signal clôturé AVANT de demander
 * l'autorisation de publier : quand le régulateur refusait, le message était
 * simplement abandonné, et plus rien ne pouvait le rattraper puisque le signal
 * n'était plus « ouvert ».
 *
 * Constaté le 10/08 : les signaux #25 et #26 sont arrivés à échéance à la même
 * minute. Le premier a été publié à 16:45, le second JAMAIS — l'espacement de
 * vingt minutes l'a refusé, et il est mort là.
 *
 * Le commentaire posé à l'époque disait pourtant « elle ne peut pas être
 * supprimée, seulement différée ». Le code faisait l'inverse. C'est exactement
 * la promesse centrale du canal gratuit qui tombait : « chaque signal est
 * republié ICI à sa clôture, gagnant ou perdant ».
 *
 * La reprise se fait sans colonne supplémentaire : un signal clôturé, diffusé
 * au canal, et dépourvu de sa ligne `cloture:<id>` dans `channel_posts` est
 * une clôture manquante. Une seule par passage — le cron repasse toutes les
 * cinq minutes, et l'espacement reste respecté.
 */
async function republierCloturesManquees(env: Env, db: ReturnType<typeof dbConfig>): Promise<void> {
  if (!env.TELEGRAM_CHANNEL_ID) return;
  // Même silence nocturne que la clôture elle-même : sans ça, le rattrapage
  // republierait à 4 h du matin ce que la clôture vient de différer pour
  // exactement cette raison.
  if (isQuietHours()) return;

  const depuis = new Date(Date.now() - JOURS_RATTRAPAGE_CLOTURES * 86_400_000).toISOString();

  let clotures: SignalRecord[];
  let postes: { reference: string | null }[];
  try {
    [clotures, postes] = await Promise.all([
      // REQUÊTE DÉDIÉE, ET C'EST DÉLIBÉRÉ.
      //
      // La version précédente réutilisait getSignalsResolvedSince(), dont le
      // `select` ne rend que quatre colonnes : type, entry_price,
      // outcome_price, close_reason. Ni `id`, ni `sent_to_channel`. La
      // condition ci-dessous lisait donc `undefined && …` — le rattrapage
      // n'aurait JAMAIS republié quoi que ce soit, sans une ligne d'erreur.
      //
      // Les tests ne l'ont pas vu parce que leur bouchon `fetch` rend la ligne
      // entière quel que soit le `select` demandé. Un correctif qui échoue en
      // silence pour réparer un bug qui échouait en silence : exactement le
      // défaut dominant de ce projet, reproduit dans sa propre réparation.
      selectRows<SignalRecord>(db, "signals", {
        evaluated_at: `gte.${depuis}`,
        outcome: "not.is.null",
        sent_to_channel: "is.true",
        select: PROJECTION_SIGNAL_COMPLET,
        // Chronologique : sur un canal public, republier la clôture de mardi
        // après celle de mercredi serait plus déroutant que le manque.
        order: "evaluated_at.asc",
        limit: "50",
      }),
      selectRows<{ reference: string | null }>(db, "channel_posts", {
        canal: "eq.public",
        categorie: "eq.resultat",
        sent_at: `gte.${depuis}`,
        select: "reference",
        limit: "200",
      }),
    ]);
  } catch (err) {
    console.error("[post-trade] Rattrapage des clôtures impossible :", err);
    return;
  }

  const dejaPublie = new Set(postes.map((p) => p.reference).filter(Boolean));
  const manquante = clotures.find((s) => s.sent_to_channel && !dejaPublie.has(`cloture:${s.id}`));
  if (!manquante) return;

  const verdict = await peutPublier(db, "public", "resultat");
  if (!verdict.autorise) return; // l'espacement n'est pas écoulé : au prochain passage

  // pnlEffectif, PAS computePnlPct. C'est la seconde moitié de la
  // contradiction du 15/08 : même avec `tp1_hit_at` correctement projeté, ce
  // calcul-ci ignorait les sorties partielles et publiait « +10,8 % » là où le
  // message privé du même abonné annonçait « +9,3 % ». Le chiffre le plus
  // flatteur des deux partait sur le canal d'acquisition.
  const pct = pnlEffectif(manquante, manquante.outcome_price ?? null);

  try {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      Number(env.TELEGRAM_CHANNEL_ID),
      formatPublicCloseMessage(manquante, pct, env.TELEGRAM_BOT_USERNAME),
      { markdown: true }
    );
    await enregistrerEnvoi(db, "public", "resultat", `cloture:${manquante.id}`);
    console.log(`[post-trade] Clôture #${manquante.id} republiée en rattrapage.`);
  } catch (err) {
    console.error(`[post-trade] Rattrapage de la clôture #${manquante.id} en échec :`, err);
  }
}

export async function trackSignalOutcomes(env: Env): Promise<void> {
  const db = dbConfig(env);

  // AVANT tout le reste : une clôture refusée par l'espacement doit repartir,
  // sans quoi elle est perdue définitivement (voir la fonction ci-dessus).
  await republierCloturesManquees(env, db).catch((err) =>
    console.error("[post-trade] Rattrapage des clôtures en échec :", err)
  );
  const open = await getOpenSignals(db);
  if (open.length === 0) return;

  const pairs = Array.from(new Set(open.map((s) => s.pair)));
  const prices = await getCurrentPrices(pairs);

  const now = Date.now();

  for (const signal of open) {
    // getOpenSignals a déjà écarté les carrys, seuls signaux dont le stop et
    // l'objectif peuvent être nuls. On le rend explicite ici : un signal
    // directionnel sans stop est une anomalie d'insertion, et le suivre
    // produirait des clôtures arbitraires.
    if (signal.stop_loss == null || signal.take_profit == null) {
      console.error(`[post-trade] ${signal.pair} (#${signal.id}) ignoré : stop ou objectif absent sur un signal directionnel.`);
      continue;
    }
    const stopLoss = signal.stop_loss;
    const takeProfit = signal.take_profit;
    const currentPrice = prices[pairToSymbol(signal.pair)];
    const isMultiTp = signal.tp1_price != null;

    // Mission "grille d'excellence" : progression TP1 (sécurisation +
    // break-even) -> TP2 -> TP3, au lieu d'un SL/TP binaire. Les signaux
    // générés avant ce changement (tp1_price absent) suivent l'ancienne
    // logique evaluateOutcome, inchangée.
    if (isMultiTp && currentPrice !== undefined) {
      const progress = evaluateMultiTpProgress(
        {
          type: signal.type,
          entryPrice: signal.entry_price,
          stopLoss: signal.stop_loss,
          tp1Price: signal.tp1_price ?? null,
          tp2Price: signal.tp2_price ?? null,
          tp3Price: signal.tp3_price ?? null,
          tp1HitAt: signal.tp1_hit_at ?? null,
          tp2HitAt: signal.tp2_hit_at ?? null,
          tp3HitAt: signal.tp3_hit_at ?? null,
          breakevenActive: signal.breakeven_active ?? false,
        },
        currentPrice
      );

      if (progress.kind === "tp1_hit") {
        await markTp1Hit(db, signal.id);
        const recipients = await getDeliveryRecipients(db, signal.id);
        await notifyRecipients(env, recipients, formatTp1HitMessage(signal));
        continue;
      }
      if (progress.kind === "tp2_hit") {
        await markTp2Hit(db, signal.id);
        const recipients = await getDeliveryRecipients(db, signal.id);
        const pctAtTp2 = computePnlPct(signal.type, signal.entry_price, signal.tp2_price ?? signal.entry_price);
        // UN seul message, pas deux. L'annonce du TP2 et le texte partageable
        // partaient dos à dos dans la même seconde : deux notifications pour un
        // seul événement, c'est la définition du spam. Assemblés, ils se lisent
        // mieux — la bonne nouvelle, puis quoi en faire.
        await notifyEachRecipient(env, recipients, (id) =>
          `${formatTp2HitMessage(signal)}\n\n${formatShareableVictory(signal, pctAtTp2, env, id)}`
        );
        await broadcastCelebration(env, signal, "TP2", pctAtTp2);
        continue;
      }
      if (progress.kind === "closed") {
        // TP3 (le runner) est le seul cas de "closed" qui merite une
        // celebration -- une sortie via break-even ou stop initial est deja
        // couverte par formatSubscriberCloseMessage, pas de doublon festif.
        const isTp3Win = signal.tp3_price != null && progress.outcome === "WIN" && progress.exitPrice === signal.tp3_price;
        if (isTp3Win) {
          const pctAtTp3 = computePnlPct(signal.type, signal.entry_price, progress.exitPrice);
          await broadcastCelebration(env, signal, "TP3", pctAtTp3);
          // Le texte partageable voyage AVEC le message de clôture au lieu de le
          // précéder d'une seconde : deux notifications pour la même nouvelle
          // n'apportaient rien, sinon une vibration de plus.
          // La célébration TP3 vient de partir sur le canal VIP : la clôture
          // ne doit pas y republier le même événement.
          await closeSignal(
            env,
            db,
            signal,
            progress.outcome,
            progress.exitPrice,
            progress.closeReason,
            (id) => formatShareableVictory(signal, pctAtTp3, env, id),
            true
          );
        } else {
          await closeSignal(env, db, signal, progress.outcome, progress.exitPrice, progress.closeReason, partageSiGagnant(env, signal, progress));
        }
        continue;
      }
      // "none" : ni niveau franchi ni stop touché -> vérifie le timeout ci-dessous.
    }

    const hit =
      !isMultiTp && currentPrice !== undefined ? evaluateOutcome(signal.type, stopLoss, takeProfit, currentPrice) : null;

    let outcome: "WIN" | "LOSS";
    let closeReason: CloseReason;
    if (hit) {
      outcome = hit.outcome;
      closeReason = hit.closeReason;
    } else if (now >= holdDeadlineMs(signal)) {
      // LE VERDICT SUIT L'ARGENT, PAS LE DRAPEAU TP1.
      //
      // Cette branche appliquait « TP1 sécurisé -> WIN, sinon LOSS », et elle a
      // publié sur le canal public, le 12/08/2026 :
      //
      //   ❌ Signal clôturé — perdant
      //   ACHAT TAO/USDT — sortie à 204.35 (+0.3%)
      //
      // Une étiquette négative et un nombre positif sur la même ligne. Le
      // 11/08, BNB était sorti à +1,40 % et comptait aussi comme une perte.
      //
      // Elle se réclamait pourtant de signals/backtest.py, dont la convention
      // écrite dit exactement l'inverse : « outcome = WIN si TP1 a été atteint
      // OU SI LE PNL FINAL EST POSITIF ». La seconde moitié de la règle avait
      // été perdue en route. Le relevé publié était donc plus mauvais que la
      // stratégie mesurée — et incohérent avec le backtest que le produit cite.
      //
      // closeReason reste « expired » DANS LES DEUX CAS. Il valait « tp_hit »
      // quand TP1 avait été touché, ce qui faisait écrire « Objectif atteint. »
      // au message public — pour ICP, sorti à 2.238 alors que son objectif
      // était à 2.3356. Le signal n'a pas atteint son objectif : il est arrivé
      // à son échéance après l'avoir touché en cours de route. Ce n'est pas la
      // même phrase, et la différence est vérifiable par n'importe quel lecteur
      // qui compare les deux nombres publiés dans le même message.
      const pnlFinal = currentPrice !== undefined ? computePnlPct(signal.type, signal.entry_price, currentPrice) : 0;
      outcome = (isMultiTp && signal.tp1_hit_at) || pnlFinal > 0 ? "WIN" : "LOSS";
      closeReason = "expired";
    } else {
      // UX — trailing stop optionnel (/prefs, opt-in) : toujours ouvert, mais
      // le prix a peut-être assez progressé pour remonter le niveau indicatif.
      // Aucun impact sur stop_loss/take_profit/outcome (voir signalMath.ts).
      if (currentPrice !== undefined) {
        const newTrailingStop = computeTrailingStop(signal.type, signal.entry_price, signal.stop_loss, signal.trailing_stop_price, currentPrice);
        if (newTrailingStop !== null) {
          await updateTrailingStop(db, signal.id, newTrailingStop);
          const recipients = await getDeliveryRecipients(db, signal.id);
          const trailingRecipients = await filterByPrefEnabled(db, recipients, "trailing_stop");
          await notifyRecipients(env, trailingRecipients, formatTrailingStopUpdate(signal, newTrailingStop));
        }
      }
      continue; // toujours ouvert
    }

    const outcomePrice = currentPrice ?? null;
    await closeSignal(env, db, signal, outcome, outcomePrice, closeReason,
      partageSiGagnant(env, signal, { outcome, exitPrice: outcomePrice }));
  }
}
