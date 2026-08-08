/**
 * Le compteur d'essais du jour.
 *
 * POURQUOI IL EXISTE. « Plus que 4 places aujourd'hui » n'a de valeur que si
 * c'est vrai. Une rareté inventée se retourne contre le produit au premier
 * lecteur qui revient le lendemain et retrouve le même chiffre : il comprend
 * que le compteur est décoratif, et à partir de là plus rien de ce qu'on écrit
 * n'est crédible — y compris les chiffres de performance, qui eux sont exacts.
 *
 * Ce compteur est donc réel, remis à zéro chaque jour UTC, et incrémenté
 * seulement quand un essai est effectivement accordé.
 *
 * CE QU'IL PROTÈGE AUSSI, accessoirement : chaque essai consomme des envois
 * Telegram et de la place dans le suivi. Dix par jour est une borne haute
 * confortable pour l'audience actuelle, pas une contrainte technique.
 *
 * DÉGRADATION. Toute erreur de lecture ACCORDE l'essai. Refuser un essai à
 * cause d'un hoquet de base coûterait un abonné potentiel ; en accorder un de
 * trop ne coûte rien.
 */

import { SupabaseConfig, selectRows, upsertRow } from "../supabaseRest";

/**
 * Dix par jour. Assez pour ne jamais bloquer une vraie affluence à ce stade du
 * projet, assez peu pour que le compteur veuille dire quelque chose.
 */
export const ESSAIS_MAX_PAR_JOUR = 10;

function jourUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

interface Ligne {
  jour: string;
  accordes: number;
}

async function accordesAujourdhui(db: SupabaseConfig): Promise<number | null> {
  try {
    const rows = await selectRows<Ligne>(db, "trial_daily_counter", { jour: `eq.${jourUtc()}` });
    return rows[0]?.accordes ?? 0;
  } catch (err) {
    console.error("[essais] Lecture du compteur impossible — essai accordé par défaut :", err);
    return null;
  }
}

/**
 * Places restantes aujourd'hui, ou `null` si le compteur est illisible.
 *
 * L'appelant doit traiter `null` comme « pas de limite affichable » et laisser
 * passer : mieux vaut ne pas afficher de compteur que d'en afficher un faux, et
 * mieux vaut accorder un essai de trop que refuser un abonné potentiel.
 */
export async function placesEssaiRestantes(db: SupabaseConfig): Promise<number | null> {
  const accordes = await accordesAujourdhui(db);
  if (accordes === null) return null;
  return Math.max(0, ESSAIS_MAX_PAR_JOUR - accordes);
}

/** À appeler UNIQUEMENT après qu'un essai a réellement été activé. */
export async function enregistrerEssaiAccorde(db: SupabaseConfig): Promise<void> {
  const accordes = (await accordesAujourdhui(db)) ?? 0;
  try {
    await upsertRow(db, "trial_daily_counter", { jour: jourUtc(), accordes: accordes + 1 }, "jour");
  } catch (err) {
    // Non bloquant : perdre un incrément fait au pire accorder un essai de
    // plus. Faire échouer l'activation pour cette raison serait absurde —
    // l'utilisateur a déjà rempli les conditions.
    console.error("[essais] Incrément du compteur impossible :", err);
  }
}
