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
 * 23 h–7 h UTC couvre 1 h–9 h à Paris en été (UTC+2) et 0 h–8 h en hiver
 * (UTC+1) : la nuit est couverte toute l'année sans jamais mordre sur la
 * journée utile.
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

export const QUIET_START_UTC = 23;
export const QUIET_END_UTC = 7;

export function isQuietHours(now: Date = new Date()): boolean {
  const hour = now.getUTCHours();
  // Intervalle qui enjambe minuit : vrai si l'heure est >= 23 OU < 7.
  return hour >= QUIET_START_UTC || hour < QUIET_END_UTC;
}
