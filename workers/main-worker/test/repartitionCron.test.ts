import { describe, it, expect } from "vitest";
// @ts-expect-error -- import brut fourni par Vite, resolu a la compilation.
import SOURCE from "../src/index.ts?raw";

/**
 * La chaîne des quinze minutes saturait la limite de sous-requêtes.
 *
 * Dix-neuf tâches s'exécutaient à la suite dans une seule invocation. Un Worker
 * Cloudflare est plafonné à 50 sous-requêtes par invocation : la chaîne
 * l'épuisait, et tout ce qui venait après mourait sur « Too many subrequests ».
 * Constaté en production le 09/08/2026 — les huit dernières tâches, dont la
 * séquence de bienvenue et les relances de réabonnement, ne tournaient plus.
 *
 * Rien ne le signalait : chaque .catch() journalisait sans faire échouer le
 * cron. Ce fichier vérifie donc la propriété qu'aucun test d'exécution ne
 * couvre — que la répartition existe, et que RIEN n'a été perdu en la faisant.
 *
 * Lecture du source plutôt qu'exécution : le handler `scheduled` déclenche des
 * dizaines d'appels réseau, et ce qu'on veut garantir ici est structurel.
 *
 * L'import `?raw` de Vite est resolu a la compilation : node:fs n'existe pas
 * dans le runtime Workers ou tourne cette suite.
 */

const BLOC_15 = (() => {
  const debut = SOURCE.indexOf('if (event.cron === "*/15 * * * *")');
  expect(debut).toBeGreaterThan(-1);
  return SOURCE.slice(debut);
})();

/** Les dix-neuf tâches qui composaient la chaîne avant la répartition. */
const TACHES = [
  "dispatchWeeklyRecap",
  "dispatchEducationalPost",
  "dispatchNoSignalStatus",
  "trackCarryOutcomes",
  "runLuckyVipDay",
  "revertLuckyVip",
  "checkExpirationReminders",
  "sendReengagementOffers",
  "sendSatisfactionSurveys",
  "sendWelcomeFollowUps",
  "sendTrialMidpointRecap",
  "runDailyMaintenance",
  "ensureChannelPinned",
  "postChannelReminder",
  "dispatchVipBriefing",
  "dispatchSelectivityDigest",
  "monthlyRecap",
  "rotateVipInviteLinkIfDue",
  "revokeExpiredVip",
] as const;

describe("Répartition de la chaîne des quinze minutes", () => {
  it("choisit un créneau à partir de la minute", () => {
    expect(BLOC_15).toMatch(/getUTCMinutes\(\)\s*\/\s*15/);
  });

  it("les quatre créneaux existent", () => {
    for (const n of [0, 1, 2]) {
      expect(BLOC_15, `créneau ${n} manquant`).toContain(`creneau === ${n}`);
    }
    // Le quatrième est le cas par défaut, sans test explicite : il attrape
    // tout ce qui n'est pas 0, 1 ou 2, donc aucune minute ne reste orpheline.
    expect(BLOC_15).toContain("rotateVipInviteLinkIfDue(env)");
  });

  it("AUCUNE tâche n'a été perdue dans la répartition", () => {
    // Le vrai risque de cette refonte : déplacer dix-neuf appels à la main et
    // en oublier un. Rien ne le signalerait — la tâche cesserait simplement de
    // tourner, exactement le silence qu'on vient de corriger.
    for (const tache of TACHES) {
      expect(BLOC_15, `${tache} absente de la chaîne`).toContain(`${tache}(env)`);
    }
  });

  it("aucune tâche n'est appelée deux fois", () => {
    for (const tache of TACHES) {
      const occurrences = BLOC_15.split(`${tache}(env)`).length - 1;
      expect(occurrences, `${tache} appelée ${occurrences} fois`).toBe(1);
    }
  });

  it("les tâches d'abonnement et de rétention occupent le PREMIER créneau", () => {
    // Si un groupe devait de nouveau saturer un jour, ce ne doit pas être
    // celui qui porte le revenu.
    const premier = BLOC_15.slice(BLOC_15.indexOf("creneau === 0"), BLOC_15.indexOf("creneau === 1"));
    for (const tache of ["checkExpirationReminders", "sendWelcomeFollowUps", "sendTrialMidpointRecap", "revokeExpiredVip"]) {
      expect(premier, `${tache} devrait être dans le premier créneau`).toContain(tache);
    }
  });

  it("aucun groupe ne dépasse six tâches", () => {
    // Six appels laissent une marge très large sous les 50 sous-requêtes,
    // même si une tâche en consomme plusieurs.
    //
    // Le découpage se fait sur les trois marqueurs `creneau === n` PUIS sur le
    // `return;` qui ferme le troisième bloc : le quatrième groupe est le cas
    // par défaut, sans marqueur. Découper naïvement sur les seuls marqueurs
    // fusionnerait les groupes 2 et 3 et rendrait ce test faux.
    const bornes = [0, 1, 2].map((n) => BLOC_15.indexOf(`creneau === ${n}`));
    const finDuTroisieme = BLOC_15.indexOf("return;", bornes[2]) + "return;".length;
    const groupes = [
      BLOC_15.slice(bornes[0], bornes[1]),
      BLOC_15.slice(bornes[1], bornes[2]),
      BLOC_15.slice(bornes[2], finDuTroisieme),
      BLOC_15.slice(finDuTroisieme),
    ];

    for (const [i, groupe] of groupes.entries()) {
      const n = TACHES.filter((t) => groupe.includes(`${t}(env)`)).length;
      expect(n, `le groupe ${i} contient ${n} tâches`).toBeLessThanOrEqual(6);
      expect(n, `le groupe ${i} est vide`).toBeGreaterThan(0);
    }

    // Et la somme redonne bien les dix-neuf : aucune tâche n'est tombée entre
    // deux groupes lors du découpage.
    const total = groupes.reduce((s, g) => s + TACHES.filter((t) => g.includes(`${t}(env)`)).length, 0);
    expect(total).toBe(TACHES.length);
  });
});
