import { describe, it, expect, vi, afterEach } from "vitest";
import { peutPublier, enregistrerEnvoi, REGLAGES } from "../src/channelBudget";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const db = { url: "https://fake-supabase.test", key: "k" } as any;

/** Une ligne de journal, il y a `minutes` minutes. */
function post(categorie: string, minutes: number) {
  return { categorie, sent_at: new Date(Date.now() - minutes * 60_000).toISOString() };
}

function stub(posts: unknown[], opts: { erreurLecture?: boolean } = {}) {
  const inseres: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("channel_posts") && (!init || init.method === undefined)) {
        if (opts.erreurLecture) return new Response("boom", { status: 500 });
        return jsonResponse(posts);
      }
      if (url.includes("channel_posts") && init?.method === "POST") {
        inseres.push(JSON.parse(init.body as string));
        return jsonResponse([{}]);
      }
      return jsonResponse([]);
    })
  );
  return { inseres };
}

describe("Le régulateur de messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  describe("l'espacement, qui casse les rafales", () => {
    // C'est la règle qui corrige le retour « des fois on reçoit quatre messages
    // à la fois » : le cron des quinze minutes exécute une vingtaine de tâches
    // à la suite dans la même invocation, et chacune ne connaissait qu'elle-même.
    it("refuse un message qui suit de trop près le précédent", async () => {
      stub([post("editorial", 3)]);
      const v = await peutPublier(db, "public", "editorial");
      expect(v.autorise).toBe(false);
      expect(v.motif).toContain("espacement");
    });

    it("autorise une fois l'espacement écoulé", async () => {
      stub([post("editorial", REGLAGES.public.espacementMinutes + 1)]);
      expect((await peutPublier(db, "public", "editorial")).autorise).toBe(true);
    });

    it("s'applique AUSSI aux signaux : rien ne part en rafale, même de prioritaire", async () => {
      stub([post("signal", 2)]);
      expect((await peutPublier(db, "public", "signal")).autorise).toBe(false);
    });

    it("autorise le tout premier message de la journée", async () => {
      stub([]);
      expect((await peutPublier(db, "public", "editorial")).autorise).toBe(true);
    });
  });

  describe("le plafond quotidien", () => {
    it("bloque l'éditorial une fois le plafond du canal atteint", async () => {
      const pleins = Array.from({ length: REGLAGES.public.plafondQuotidien }, (_, i) => post("signal", 60 + i));
      stub(pleins);
      const v = await peutPublier(db, "public", "editorial");
      expect(v.autorise).toBe(false);
      expect(v.motif).toContain("plafond");
    });

    it("laisse TOUJOURS passer un signal, même au-delà du plafond", async () => {
      // Un abonné paie pour recevoir les signaux. Les retenir parce qu'une
      // anecdote est passée avant serait l'inverse du service rendu.
      const pleins = Array.from({ length: REGLAGES.public.plafondQuotidien + 5 }, (_, i) => post("editorial", 60 + i));
      stub(pleins);
      expect((await peutPublier(db, "public", "signal")).autorise).toBe(true);
      expect((await peutPublier(db, "public", "resultat")).autorise).toBe(true);
    });

    it("borne l'éditorial bien avant le plafond global", async () => {
      const editoriaux = Array.from({ length: REGLAGES.public.editorialMax }, (_, i) => post("editorial", 60 + i));
      stub(editoriaux);
      const v = await peutPublier(db, "public", "editorial");
      expect(v.autorise).toBe(false);
      expect(v.motif).toContain("éditorial");
      // Mais un rendez-vous quotidien passe encore : le quota éditorial ne doit
      // pas faire taire la liste du jour.
      expect((await peutPublier(db, "public", "quotidien")).autorise).toBe(true);
    });
  });

  describe("les réglages par canal", () => {
    it("le canal public est plus strict que le VIP, sur les trois axes", async () => {
      // Le public est vu par des gens qui n'ont rien demandé et ne paient rien :
      // son seuil de tolérance est le plus bas du produit.
      expect(REGLAGES.public.plafondQuotidien).toBeLessThan(REGLAGES.vip.plafondQuotidien);
      expect(REGLAGES.public.editorialMax).toBeLessThan(REGLAGES.vip.editorialMax);
      expect(REGLAGES.public.espacementMinutes).toBeGreaterThan(REGLAGES.vip.espacementMinutes);
    });

    it("compte séparément les deux canaux", async () => {
      // Le journal est filtré sur `canal` : un canal saturé ne doit pas faire
      // taire l'autre.
      let urlLue = "";
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          urlLue = url;
          return jsonResponse([]);
        })
      );
      await peutPublier(db, "vip", "editorial");
      expect(urlLue).toContain("canal=eq.vip");
    });
  });

  describe("la dégradation", () => {
    it("AUTORISE quand le journal est illisible", async () => {
      // Le pire cas d'un régulateur en panne est un canal un peu trop bavard.
      // Le pire cas d'un régulateur trop strict est un canal muet sans que
      // personne ne sache pourquoi — c'est bien plus grave.
      stub([], { erreurLecture: true });
      const v = await peutPublier(db, "public", "editorial");
      expect(v.autorise).toBe(true);
      expect(v.motif).toContain("indisponible");
    });

    it("n'échoue pas quand la journalisation échoue", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("boom", { status: 500 }))
      );
      // Perdre une ligne de journal fait au pire publier un message de trop.
      // Faire échouer l'envoi pour cette raison serait pire.
      await expect(enregistrerEnvoi(db, "public", "signal", "x")).resolves.toBeUndefined();
    });
  });

  describe("la journalisation", () => {
    it("écrit le canal, la catégorie, la priorité et la référence", async () => {
      const { inseres } = stub([]);
      await enregistrerEnvoi(db, "vip", "quotidien", "bilan-momentum");
      expect(inseres).toHaveLength(1);
      expect(inseres[0]).toMatchObject({ canal: "vip", categorie: "quotidien", reference: "bilan-momentum" });
    });

    it("classe un signal plus prioritaire qu'un éditorial", async () => {
      const { inseres } = stub([]);
      await enregistrerEnvoi(db, "public", "signal");
      await enregistrerEnvoi(db, "public", "editorial");
      const [signal, editorial] = inseres as { priorite: number }[];
      expect(signal.priorite).toBeLessThan(editorial.priorite);
    });
  });
});
