/**
 * Journaliser une panne UNE FOIS, sans jamais la faire disparaître.
 *
 * LE PROBLÈME. `pollPayments` tourne toutes les cinq minutes et journalise
 * chaque échec. Quand la cause est permanente — le RPC Polygon public élague
 * son historique, donc `eth_getLogs` sur un bloc ancien échouera indéfiniment —
 * ça produit 288 lignes identiques par jour. Le journal devient illisible, et
 * les vraies pannes s'y noient.
 *
 * POURQUOI PAS UNE SIMPLE DÉDUPLICATION. Taire complètement une erreur
 * récurrente est pire que la répéter : un problème permanent disparaîtrait du
 * journal, et plus personne ne saurait qu'il existe. C'est exactement le
 * « vert qui n'a rien fait » corrigé ailleurs dans ce projet.
 *
 * LE COMPROMIS RETENU : première occurrence journalisée, répétitions tues, et
 * un rappel toutes les six heures tant que la panne dure. Le retour à la
 * normale est journalisé lui aussi — sans quoi on ne saurait jamais qu'une
 * panne s'est terminée.
 *
 * L'ÉTAT EST EN MÉMOIRE, et c'est assumé. Un isolat Workers est recyclé
 * régulièrement, ce qui remet le compteur à zéro et laisse repasser une ligne.
 * C'est sans gravité : le pire cas est quelques lignes de plus, jamais une
 * panne masquée. Persister ça en base coûterait une écriture toutes les cinq
 * minutes pour économiser une ligne de journal.
 */

/** Rappel tant que la panne dure. Six heures : visible dans la journée, sans bruit. */
export const INTERVALLE_RAPPEL_MS = 6 * 60 * 60 * 1000;

interface Etat {
  signature: string;
  premiereMs: number;
  dernierLogMs: number;
  occurrences: number;
}

const etats = new Map<string, Etat>();

/** Réinitialise l'état. Réservé aux tests — la production n'en a jamais besoin. */
export function reinitialiserJournalUneFois(): void {
  etats.clear();
}

/**
 * @param cle       identifiant stable du point de panne (ex. "usdt-offchain")
 * @param erreur    l'erreur rencontrée
 * @param maintenant injectable pour les tests
 */
export function journaliserErreurUneFois(cle: string, erreur: unknown, maintenant = Date.now()): void {
  const signature = erreur instanceof Error ? erreur.message : String(erreur);
  const precedent = etats.get(cle);

  // Panne nouvelle, ou cause DIFFÉRENTE de la précédente : on journalise.
  // Comparer la signature compte — passer d'un « historique élagué » à un
  // « 401 non autorisé » est une information, pas une répétition.
  if (!precedent || precedent.signature !== signature) {
    etats.set(cle, { signature, premiereMs: maintenant, dernierLogMs: maintenant, occurrences: 1 });
    console.error(`[${cle}] ${signature}`);
    return;
  }

  precedent.occurrences += 1;

  if (maintenant - precedent.dernierLogMs >= INTERVALLE_RAPPEL_MS) {
    const heures = Math.round((maintenant - precedent.premiereMs) / 3_600_000);
    console.error(
      `[${cle}] Toujours en échec depuis ${heures} h (${precedent.occurrences} tentatives) : ${signature}`
    );
    precedent.dernierLogMs = maintenant;
  }
}

/**
 * L'ÉTAT EN MÉMOIRE NE SURVIT PAS À UNE INVOCATION DE CRON. Mesuré, pas supposé.
 *
 * Le commentaire d'en-tête pariait qu'un isolat recyclé « laisse repasser une
 * ligne » de temps en temps. Observé en production le 10/08/2026 sur deux
 * cycles consécutifs :
 *
 *   19:55  (error) [prix-binance] Binance ticker/price a répondu 403 …
 *   20:00  (error) [prix-binance] Binance ticker/price a répondu 403 …
 *
 * Chaque déclenchement de cron repart d'un isolat neuf : la Map est vide à
 * chaque fois, et la déduplication ne déduplique donc RIEN entre deux cycles.
 * Le pire cas n'était pas « quelques lignes de plus », c'était toutes.
 *
 * Pour les pannes dont la permanence est CONNUE — Binance qui refuse les IP
 * d'hébergeur, le wallet-rpc Monero qui vit sur un PC éteint — la seule
 * solution sans état est l'horloge. Une ligne par heure : le fait reste
 * visible, sa répétition ne noie plus le journal.
 *
 * CE QUI EST ÉCHANGÉ, et il faut le savoir : la première occurrence n'est plus
 * immédiate. C'est acceptable ici précisément parce que ces conditions ne sont
 * pas des nouvelles. Pour une panne dont la nature est inconnue,
 * `journaliserErreurUneFois` reste le bon outil — mieux vaut une ligne de trop
 * qu'une découverte retardée d'une heure.
 *
 * Persister l'état en base serait exact, mais coûterait une lecture et une
 * écriture Supabase à chaque cycle de cinq minutes, dans la chaîne dont la
 * limite de cinquante sous-requêtes est le point de rupture connu du projet.
 * Payer ça pour une ligne de journal serait un mauvais échange.
 */
export function journaliserPanneConnue(cle: string, message: string, maintenant = new Date()): void {
  // Premier cycle de chaque heure. Le cron tourne toutes les cinq minutes,
  // donc exactement une invocation par heure passe ce filtre.
  if (maintenant.getUTCMinutes() >= 5) return;
  console.error(`[${cle}] ${message}`);
}

/**
 * À appeler quand l'opération réussit. Journalise le rétablissement si une
 * panne était en cours, puis oublie l'état.
 */
export function signalerRetablissement(cle: string, maintenant = Date.now()): void {
  const precedent = etats.get(cle);
  if (!precedent) return;
  const heures = Math.round((maintenant - precedent.premiereMs) / 3_600_000);
  console.log(
    `[${cle}] Rétabli après ${heures} h et ${precedent.occurrences} tentative(s) en échec.`
  );
  etats.delete(cle);
}
