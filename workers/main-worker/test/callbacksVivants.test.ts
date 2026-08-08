import { describe, it, expect } from "vitest";

/**
 * Aucun bouton ne doit pointer vers un callback que le routeur ignore.
 *
 * Un bouton mort ne plante pas : Telegram accepte le clic, le routeur ne
 * reconnaît pas la donnée, et il ne se passe RIEN. Personne ne le voit dans
 * les logs, aucun test ne tombe, et l'utilisateur conclut que le bot est
 * cassé. C'est exactement ce qui a failli arriver en ajoutant un bouton
 * « Rejoindre le canal VIP » avec `start:vip`, qui n'existait pas encore.
 *
 * On compare donc les callback_data écrits dans les sources aux préfixes que
 * le routeur sait traiter.
 */

const SOURCES = import.meta.glob("../src/**/*.ts", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

/** Les `callback_data: "..."` littéraux trouvés dans les sources. */
function callbacksEmis(): Map<string, string[]> {
  const trouves = new Map<string, string[]>();
  for (const [chemin, contenu] of Object.entries(SOURCES)) {
    if (chemin.endsWith("router.ts")) continue;
    for (const m of contenu.matchAll(/callback_data:\s*[`"']([^`"'$]+)[`"']/g)) {
      const liste = trouves.get(m[1]) ?? [];
      liste.push(chemin);
      trouves.set(m[1], liste);
    }
  }
  return trouves;
}

/** Ce que le routeur reconnaît : égalités exactes et préfixes. */
function routeurConnait(): { exacts: Set<string>; prefixes: string[] } {
  const routeur = Object.entries(SOURCES).find(([c]) => c.endsWith("bot/router.ts"))?.[1] ?? "";
  const exacts = new Set([...routeur.matchAll(/data === "([^"]+)"/g)].map((m) => m[1]));
  const prefixes = [...routeur.matchAll(/data\.startsWith\("([^"]+)"\)/g)].map((m) => m[1]);
  return { exacts, prefixes };
}

describe("Les boutons pointent tous vers un callback vivant", () => {
  it("le scan trouve bien le routeur et des boutons", () => {
    // Un glob qui ne correspond à rien rendrait le test suivant vert pour
    // toujours — la panne même qu'il doit empêcher.
    const { exacts, prefixes } = routeurConnait();
    expect(exacts.size + prefixes.length).toBeGreaterThan(5);
    expect(callbacksEmis().size).toBeGreaterThan(5);
  });

  it("aucun callback_data n'est ignoré par le routeur", () => {
    const { exacts, prefixes } = routeurConnait();
    const morts: string[] = [];

    for (const [donnee, fichiers] of callbacksEmis()) {
      const reconnu = exacts.has(donnee) || prefixes.some((p) => donnee.startsWith(p));
      if (!reconnu) morts.push(`"${donnee}" (${fichiers.join(", ")})`);
    }

    expect(morts).toEqual([]);
  });
});
