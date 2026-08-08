import { Env, dbConfig } from "../../env";
import { sendMessage } from "../../telegram";
import { getOrCreateUser, countReferralsBy } from "../../db/users";
import {
  buildReferralLink,
  MILESTONE_REFERRALS,
  MILESTONE_BONUS_DAYS,
  REFERRAL_BONUS_DAYS,
  JOKER_THRESHOLD_HOURS,
  JOKER_BONUS_DAYS,
} from "../referral";

export async function handleReferralCommand(env: Env, telegramId: number): Promise<void> {
  const db = dbConfig(env);
  const user = await getOrCreateUser(db, telegramId);
  // TELEGRAM_BOT_USERNAME ("ProVIPSignals_bot") contient un underscore : en
  // parse_mode Markdown, un underscore non échappé ouvre une entité italique.
  // Message impair au total (un seul underscore dans tout le message avant
  // ce correctif, voir signalFormat.ts pour le même correctif ailleurs) ->
  // "can't parse entities", tout le message rejeté par Telegram (bug vécu
  // le 29/07, même famille que /help).
  const link = buildReferralLink(env, telegramId).replace(/_/g, "\\_");
  const totalReferred = await countReferralsBy(db, telegramId);
  const paidCount = user.paid_referral_count ?? 0;
  const towardsNextMilestone = paidCount % MILESTONE_REFERRALS;

  // LA PROGRESSION N'EST AFFICHÉE QUE SI ELLE EXISTE.
  //
  // Un nouveau venu lisait quatre lignes de zéros d'affilée — « 0 personne ont
  // rejoint », « 0 filleul payant », « 0/3 vers ton prochain mois », « 0,00 USDT
  // de commissions ». C'est décourageant, et ça n'apprend rien : il vient
  // d'ouvrir la commande, évidemment que tout est à zéro.
  //
  // La « commission virtuelle de 10 % » est RETIRÉE. Elle n'était jamais versée
  // — le texte le disait lui-même entre parenthèses — mais affichée en USDT à
  // côté de vrais avantages, elle se lit comme de l'argent dû. Une ligne qu'il
  // faut désamorcer dans sa propre parenthèse n'a pas sa place.
  const progression =
    totalReferred > 0
      ? "\n\n📊 *Ta progression*\n" +
        `${totalReferred} personne(s) ont rejoint via ton lien\n` +
        `${paidCount} filleul(s) payant(s)\n` +
        `${towardsNextMilestone}/${MILESTONE_REFERRALS} vers ton prochain mois offert`
      : "\n\n_Personne n'a encore utilisé ton lien. Il suffit d'une._";

  await sendMessage(
    env.TELEGRAM_BOT_TOKEN,
    telegramId,
    "🔗 *Ton lien de parrainage*\n" +
      `${link}\n\n` +
      "Ce que ça te rapporte, concrètement :\n" +
      `• +${REFERRAL_BONUS_DAYS} jours dès qu'un filleul s'abonne (paiement confirmé)\n` +
      `• +${MILESTONE_BONUS_DAYS} jours de plus tous les ${MILESTONE_REFERRALS} filleuls payants — soit un mois offert\n` +
      `• +${JOKER_BONUS_DAYS} jours si tu parraines dans les ${JOKER_THRESHOLD_HOURS} h avant ta propre expiration\n\n` +
      "Et pour la personne qui clique : elle débloque l'essai gratuit sans avoir à rejoindre le canal." +
      progression,
    { markdown: true }
  );
}
