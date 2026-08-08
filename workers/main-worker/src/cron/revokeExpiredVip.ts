/**
 * Retire du canal VIP les abonnés dont l'accès a expiré.
 *
 * LE TROU QUE CETTE TÂCHE BOUCHE, et il était béant.
 *
 * Rien, nulle part dans le projet, ne retirait quelqu'un du canal privé. Aucun
 * appel à `banChatMember` n'existait — la seule fonction Telegram côté membres
 * était `getChatMemberStatus`, en lecture. Conséquence directe : quelqu'un qui
 * payait le Pack Découverte, 5 USDT pour 14 jours, rejoignait le canal VIP et y
 * restait POUR TOUJOURS. La rotation périodique du lien d'invitation
 * (utils/vipChannel.ts) ne change rien : elle empêche de nouveaux entrants
 * d'utiliser un vieux lien, elle n'expulse personne.
 *
 * Ce n'était pas seulement une fuite de revenu. Le canal VIP publie chaque
 * matin le point sur les positions ouvertes, entrées et stops compris
 * (cron/dispatchVipBriefing.ts) : un ancien abonné continuait donc de recevoir
 * la substance du produit. Et `/delete_my_data` affirmait « tu perdras
 * immédiatement l'accès aux signaux », ce qui était faux pour toute personne
 * ayant rejoint le canal.
 *
 * TROIS PRÉCAUTIONS, chacune contre une façon de se tromper de personne.
 *
 *  1. On ne retire QUE ceux dont l'expiration est dépassée d'au moins
 *     DELAI_DE_GRACE_HEURES. Un paiement peut arriver quelques minutes après
 *     l'échéance, et le poller ne tourne que toutes les cinq minutes : expulser
 *     à la seconde près ferait sortir des gens qui viennent de renouveler.
 *  2. Le statut réel est VÉRIFIÉ avant d'agir. Quelqu'un qui a déjà quitté le
 *     canal, ou qui n'y est jamais entré, ne doit pas générer d'appel inutile —
 *     et un administrateur ne doit jamais être touché.
 *  3. Un retrait raté n'interrompt jamais les suivants. Telegram refuse de
 *     retirer un admin et renvoie une erreur pour un membre déjà parti : ces
 *     deux cas sont normaux, pas des pannes.
 *
 * La personne est PRÉVENUE avant d'être retirée. Découvrir seul qu'on a été
 * sorti d'un canal, sans savoir pourquoi, est la pire façon de terminer une
 * relation commerciale — et la moins susceptible d'amener un réabonnement.
 */

import { Env, dbConfig } from "../env";
import { selectRows, updateRows } from "../supabaseRest";
import { removeChatMember, getChatMemberStatus, sendMessage } from "../telegram";

/**
 * Délai après l'expiration avant de retirer. Six heures : assez pour absorber
 * un renouvellement tardif et les cinq minutes du poller de paiements, assez
 * peu pour que l'accès ne survive pas à la journée.
 */
const DELAI_DE_GRACE_HEURES = 6;

/** Par passage. Le cron tourne tous les quarts d'heure : le rattrapage est rapide. */
const MAX_PAR_PASSAGE = 20;

/** Statuts qu'il ne faut jamais toucher : la personne n'est pas un membre ordinaire. */
const STATUTS_INTOUCHABLES = ["administrator", "creator", "left", "kicked"];

interface Expire {
  telegram_id: number;
  expiration: string | null;
}

export async function revokeExpiredVip(env: Env): Promise<void> {
  if (!env.TELEGRAM_VIP_CHANNEL_ID) return;

  const db = dbConfig(env);
  const seuil = new Date(Date.now() - DELAI_DE_GRACE_HEURES * 3_600_000).toISOString();

  let expires: Expire[];
  try {
    expires = await selectRows<Expire>(db, "users", {
      expiration: `lt.${seuil}`,
      vip_removed: "eq.false",
      select: "telegram_id,expiration",
      limit: String(MAX_PAR_PASSAGE),
    });
  } catch (err) {
    console.error("[vip] Lecture des abonnés expirés impossible :", err);
    return;
  }

  for (const membre of expires) {
    const statut = await getChatMemberStatus(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_VIP_CHANNEL_ID, membre.telegram_id).catch(
      () => null
    );

    // Jamais membre, déjà parti, ou administrateur : rien à faire. On marque
    // quand même, sinon la même personne serait réexaminée à chaque passage.
    if (statut === null || STATUTS_INTOUCHABLES.includes(statut)) {
      await marquerTraite(env, membre.telegram_id);
      continue;
    }

    // Prévenir AVANT de retirer : être sorti d'un canal sans explication est la
    // pire façon de terminer, et la moins susceptible d'amener un retour.
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      membre.telegram_id,
      "🔒 Ton accès au canal VIP vient de prendre fin, ton abonnement ayant expiré.\n\n" +
        "Rien n'est perdu : /subscribe te rouvre l'accès immédiatement, et tu retrouveras le canal " +
        "au même endroit. Le canal public, lui, reste ouvert — tu y verras chaque signal partir, et le " +
        "signal entier à sa clôture avec son résultat.\n\n" +
        "Merci d'avoir été là."
    ).catch((err) => console.error(`[vip] Prévenance impossible pour ${membre.telegram_id}:`, err));

    const retire = await removeChatMember(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_VIP_CHANNEL_ID, membre.telegram_id);
    if (retire) {
      console.log(`[vip] ${membre.telegram_id} retiré du canal (expiré le ${membre.expiration}).`);
    }
    // Marqué dans les deux cas : un échec récurrent (un admin, par exemple) ne
    // doit pas faire boucler ce passage indéfiniment sur la même personne.
    await marquerTraite(env, membre.telegram_id);
  }
}

async function marquerTraite(env: Env, telegramId: number): Promise<void> {
  await updateRows(dbConfig(env), "users", { telegram_id: `eq.${telegramId}` }, { vip_removed: true }).catch((err) =>
    console.error(`[vip] Marquage impossible pour ${telegramId}:`, err)
  );
}
