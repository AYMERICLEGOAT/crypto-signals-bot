/**
 * Heures calmes du canal public (retour utilisateur du 02/08/2026 : des
 * messages partaient à 2 h du matin).
 *
 * Aucune publication dans le canal public entre QUIET_START_UTC et
 * QUIET_END_UTC. Un canal qui notifie en pleine nuit se fait couper les
 * notifications, voire quitter — et le contenu concerné (posts éducatifs,
 * anecdotes, Fear & Greed, rappels, alertes de momentum) n'a aucune raison
 * d'être vu à 3 h plutôt qu'à 8 h.
 *
 * LA FENÊTRE ÉTAIT RAISONNÉE EN UTC, PAS DEPUIS LE TÉLÉPHONE DU LECTEUR.
 *
 * Elle a longtemps commencé à 23 h UTC, soit 1 h du matin à Paris en été. La
 * plage 22 h – 1 h, heure française, restait donc entièrement ouverte — et le
 * 17/08/2026 le canal public a notifié une clôture à 0 h 55. C'était légal au
 * sens du code, et c'était exactement le défaut que ce module avait été écrit
 * pour supprimer : « des messages partaient à 2 h du matin ».
 *
 * Une heure UTC ne dit rien à personne. Ce qui compte est l'heure qu'affiche le
 * téléphone de quelqu'un qui dort. 21 h – 7 h UTC couvre 23 h – 9 h à Paris en
 * été (UTC+2) et 22 h – 8 h en hiver (UTC+1) : plus aucune notification après
 * 23 h toute l'année, sans mordre sur la journée utile. Les seuls rendez-vous
 * planifiés du produit tombent à 8 h, 10 h et 18 h UTC — aucun n'est touché.
 *
 * Ce garde-fou ne concerne QUE le canal public. Les messages privés aux
 * abonnés (signaux, suivi de position, relances d'expiration) ne passent pas
 * par ici : un abonné payant attend son signal quand il se produit, pas huit
 * heures plus tard.
 *
 * La plupart des diffuseurs concernés sont protégés par un drapeau
 * « déjà envoyé » en base : sauter un cycle nocturne DIFFÈRE la publication
 * au premier cycle après 7 h, il ne la perd pas.
 */

export const QUIET_START_UTC = 21;
export const QUIET_END_UTC = 7;

export function isQuietHours(now: Date = new Date()): boolean {
  const hour = now.getUTCHours();
  // Intervalle qui enjambe minuit : vrai si l'heure est >= 23 OU < 7.
  return hour >= QUIET_START_UTC || hour < QUIET_END_UTC;
}
