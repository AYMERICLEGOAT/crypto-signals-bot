/**
 * Le régulateur de messages : qui a le droit de publier, et quand.
 *
 * LE PROBLÈME QU'IL RÉSOUT, MESURÉ AVANT DE L'ÉCRIRE.
 *
 * Vingt-sept tâches planifiées écrivent dans les canaux. Chacune a bien sa
 * garde « déjà envoyé aujourd'hui » — mais chacune ne connaît qu'elle-même, et
 * le cron des quinze minutes les exécute à la suite DANS LA MÊME INVOCATION.
 * Rien n'empêchait donc six d'entre elles de partir dans la même minute. C'est
 * exactement le retour reçu : « des fois on reçoit quatre messages à la fois ».
 *
 * Le pire jour réaliste sur le canal public, avant ce module :
 *
 *     1 liste du jour + 5 signaux + 1 lot de carrys + 5 clôtures
 *   + 1 anecdote + 1 post pédagogique + 1 Fear and Greed + 1 digest
 *   + 8 rappels de canal (toutes les 3 h) + suspensions non bornées
 *   = plus de 25 messages par jour
 *
 * Un canal qui publie vingt-cinq fois par jour n'est pas un canal très actif :
 * c'est un canal qu'on met en sourdine. Et une mise en sourdine ne se défait
 * jamais — l'abonné ne se désabonne pas, il cesse simplement d'exister.
 *
 * TROIS RÈGLES, ET UNE HIÉRARCHIE.
 *
 *  1. Un PLAFOND quotidien par canal. Au-delà, plus rien ne part de la journée,
 *     sauf ce qui est vital (voir ci-dessous).
 *  2. Un ESPACEMENT minimal entre deux messages du même canal. C'est cette
 *     règle-là qui supprime les rafales, indépendamment du plafond.
 *  3. Une PRIORITÉ. Quand la place manque, un signal passe avant une anecdote.
 *     Ce n'est pas un détail de confort : le jour où le quota est mangé par du
 *     remplissage, c'est un signal qui ne part pas.
 *
 * CE QUI N'EST JAMAIS BLOQUÉ, et pourquoi. Les SIGNAUX et leurs RÉSULTATS
 * échappent au plafond. Un abonné paie pour les recevoir ; les retenir parce
 * qu'une anecdote est passée avant serait exactement l'inverse du service rendu.
 * Ils restent soumis à l'espacement, qui les étale sans jamais en perdre.
 *
 * DÉGRADATION. Toute erreur de lecture AUTORISE l'envoi. Un journal
 * indisponible ne doit pas faire taire le produit : le pire cas d'un régulateur
 * en panne est un canal un peu trop bavard pendant quelques minutes, celui d'un
 * régulateur trop strict est un canal muet sans que personne ne sache pourquoi.
 */

import { SupabaseConfig, selectRows, insertRow, deleteRows } from "./supabaseRest";

export type Canal = "public" | "vip";

/**
 * Les quatre familles de messages, de la plus utile à la moins utile.
 *
 * L'ordre n'est pas une opinion : il suit ce qu'un abonné perd si le message
 * n'arrive pas. Un signal manqué est un trade manqué. Une anecdote manquée
 * n'est rien.
 */
export type Categorie =
  /** Un signal à jouer. Ne peut pas être retenu. */
  | "signal"
  /** Le résultat d'un signal déjà envoyé — la preuve du produit. Ne peut pas être retenu. */
  | "resultat"
  /** Un rendez-vous quotidien attendu : liste du jour, état du marché, briefing. */
  | "quotidien"
  /** Du contenu d'entretien : anecdote, pédagogie, rappel, classement. */
  | "editorial";

const PRIORITE: Record<Categorie, number> = {
  signal: 10,
  resultat: 20,
  quotidien: 40,
  editorial: 70,
};

/** Catégories qui ignorent le plafond quotidien (mais pas l'espacement). */
const INCONTOURNABLES: Categorie[] = ["signal", "resultat"];

/**
 * Réglages par canal.
 *
 * Le canal PUBLIC est vu par des gens qui ne paient rien et n'ont rien demandé :
 * son seuil de tolérance est le plus bas de tout le produit. Huit messages par
 * jour, dont au plus deux d'entretien.
 *
 * Le canal VIP est lu par des abonnés payants qui ont choisi d'y être. Il peut
 * porter davantage — mais pas les huit alertes momentum quotidiennes qu'il
 * recevait, qui n'apprenaient rien et noyaient les célébrations.
 */
export const REGLAGES: Record<Canal, { plafondQuotidien: number; editorialMax: number; espacementMinutes: number }> = {
  public: { plafondQuotidien: 8, editorialMax: 2, espacementMinutes: 20 },
  vip: { plafondQuotidien: 10, editorialMax: 3, espacementMinutes: 12 },
};

function debutDeJourUtc(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

interface LignePost {
  categorie: Categorie;
  sent_at: string;
}

async function postsDuJour(db: SupabaseConfig, canal: Canal): Promise<LignePost[] | null> {
  try {
    return await selectRows<LignePost>(db, "channel_posts", {
      canal: `eq.${canal}`,
      sent_at: `gte.${debutDeJourUtc()}`,
      select: "categorie,sent_at",
      order: "sent_at.desc",
    });
  } catch (err) {
    console.error(`[budget] Lecture du journal impossible pour ${canal} — envoi autorisé par défaut :`, err);
    return null;
  }
}

export interface Verdict {
  autorise: boolean;
  /** Motif lisible, journalisé côté serveur. Jamais montré à un utilisateur. */
  motif: string;
}

/**
 * Ce message peut-il partir maintenant ?
 *
 * À appeler AVANT l'envoi, et à faire suivre de `enregistrerEnvoi` si l'envoi a
 * effectivement eu lieu. Les deux sont séparés volontairement : un message qui
 * échoue côté Telegram ne doit pas consommer le quota du jour.
 */
export async function peutPublier(db: SupabaseConfig, canal: Canal, categorie: Categorie): Promise<Verdict> {
  const reglages = REGLAGES[canal];
  const posts = await postsDuJour(db, canal);

  // Journal illisible : on laisse passer. Voir la note de dégradation en tête
  // de module — un régulateur en panne ne doit jamais faire taire le produit.
  if (posts === null) return { autorise: true, motif: "journal indisponible" };

  // L'ESPACEMENT s'applique à TOUT, y compris aux signaux. C'est lui qui casse
  // les rafales : deux messages ne peuvent pas partir dans la même minute,
  // quelle que soit leur importance. Un signal retardé de vingt minutes reste
  // parfaitement jouable — sa sortie est à trois jours au plus court.
  const dernier = posts[0];
  if (dernier) {
    const minutes = (Date.now() - new Date(dernier.sent_at).getTime()) / 60000;
    if (minutes < reglages.espacementMinutes) {
      return {
        autorise: false,
        motif: `espacement : ${minutes.toFixed(0)} min depuis le dernier message, ${reglages.espacementMinutes} requises`,
      };
    }
  }

  if (INCONTOURNABLES.includes(categorie)) {
    return { autorise: true, motif: "catégorie incontournable" };
  }

  if (posts.length >= reglages.plafondQuotidien) {
    return { autorise: false, motif: `plafond quotidien atteint (${posts.length}/${reglages.plafondQuotidien})` };
  }

  if (categorie === "editorial") {
    const editoriaux = posts.filter((p) => p.categorie === "editorial").length;
    if (editoriaux >= reglages.editorialMax) {
      return { autorise: false, motif: `quota éditorial atteint (${editoriaux}/${reglages.editorialMax})` };
    }
  }

  return { autorise: true, motif: "ok" };
}

/**
 * Consigne un envoi RÉUSSI. Un échec ne doit rien consommer, sans quoi une
 * panne Telegram passagère mangerait le quota de la journée.
 */
export async function enregistrerEnvoi(
  db: SupabaseConfig,
  canal: Canal,
  categorie: Categorie,
  reference?: string
): Promise<void> {
  try {
    await insertRow(db, "channel_posts", {
      canal,
      categorie,
      priorite: PRIORITE[categorie],
      reference: reference ?? null,
    });
  } catch (err) {
    // Non bloquant : perdre une ligne de journal fait au pire publier un
    // message de trop. Faire échouer l'envoi pour cette raison serait pire.
    console.error(`[budget] Journalisation impossible (${canal}/${categorie}) :`, err);
  }
}

/**
 * Raccourci pour les appelants : vérifie, envoie, journalise.
 *
 * Rend true si le message est parti. Le rappel `envoyer` n'est appelé que si le
 * régulateur l'autorise, et le quota n'est consommé que s'il ne lève pas.
 */
export async function publierSiPossible(
  db: SupabaseConfig,
  canal: Canal,
  categorie: Categorie,
  envoyer: () => Promise<void>,
  reference?: string
): Promise<boolean> {
  const verdict = await peutPublier(db, canal, categorie);
  if (!verdict.autorise) {
    console.log(`[budget] ${canal}/${categorie} reporté — ${verdict.motif}`);
    return false;
  }
  await envoyer();
  await enregistrerEnvoi(db, canal, categorie, reference);
  return true;
}

/**
 * Purge du journal. Il ne sert qu'aux décisions du jour et au diagnostic
 * récent : sans nettoyage il grossirait indéfiniment pour rien, et les
 * requêtes de comptage quotidien ralentiraient sur des données que plus
 * personne ne lit.
 */
export async function purgerJournal(db: SupabaseConfig, plusVieuxQueJours: number): Promise<void> {
  const seuil = new Date(Date.now() - plusVieuxQueJours * 86_400_000).toISOString();
  await deleteRows(db, "channel_posts", { sent_at: `lt.${seuil}` });
}
