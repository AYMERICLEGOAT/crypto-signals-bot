import { describe, it, expect, vi, afterEach } from "vitest";
import { isQuietHours } from "../src/utils/quietHours";
import { dispatchCryptoFact } from "../src/cron/dispatchCryptoFact";
import { postChannelReminder } from "../src/cron/postChannelReminder";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100123",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

/** Retour utilisateur du 02/08/2026 : des messages partaient à 2 h du matin. */
describe("Heures calmes du canal public (21h-7h UTC)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("couvre toute la nuit, bornes comprises, et laisse la journée libre", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 7, 2, h, 30));
    // Nuit. LA BORNE EST PASSÉE DE 23 H À 21 H UTC le 17/08/2026 : 23 h UTC,
    // c'est 1 h du matin à Paris en été, et le canal a effectivement notifié
    // une clôture à 0 h 55. Ce test exigeait auparavant que 22 h UTC — minuit
    // à Paris — soit un créneau ouvert. Voir test/nuitFrancaise.test.ts, qui
    // raisonne en heure de Paris plutôt qu'en UTC.
    for (const h of [21, 22, 23, 0, 1, 2, 3, 4, 5, 6]) {
      expect(isQuietHours(at(h)), `${h}h UTC doit être silencieux`).toBe(true);
    }
    // Journée
    for (const h of [7, 8, 12, 18, 20]) {
      expect(isQuietHours(at(h)), `${h}h UTC doit être autorisé`).toBe(false);
    }
  });

  it("bloque une anecdote à 2h du matin sans rien écrire en base", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 2, 0)));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await dispatchCryptoFact(env);

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("laisse passer la même anecdote à 10h", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 10, 0)));
    let posted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        // Les deux lectures visent crypto_facts : les distinguer par leur
        // filtre, sinon le gate "deja publiee aujourd'hui" repond oui.
        if (url.includes("crypto_facts") && url.includes("last_sent_at=gte")) {
          return jsonResponse([]); // rien publie aujourd'hui
        }
        if (url.includes("crypto_facts") && url.includes("order=")) {
          return jsonResponse([{ id: 1, content: "Une anecdote" }]);
        }
        if (url.includes("crypto_facts")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          posted = true;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await dispatchCryptoFact(env);
    expect(posted).toBe(true);
    vi.useRealTimers();
  });

  it("le rappel de canal est unique, fusionné, et muet la nuit", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 3, 0)));
    const nightSpy = vi.fn();
    vi.stubGlobal("fetch", nightSpy);
    await postChannelReminder(env);
    expect(nightSpy).not.toHaveBeenCalled();

    // De jour, un seul message contenant les deux informations autrefois
    // réparties entre postChannelReminder et dispatchChannelCta (supprimé).
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 12, 0)));
    let sent = "";
    let sendCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats") && (!init || init.method === undefined)) return jsonResponse([]);
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("api.telegram.org")) {
          sendCount++;
          sent = JSON.parse(init!.body as string).text;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await postChannelReminder(env);
    expect(sendCount).toBe(1);
    expect(sent).toContain("temps réel");
    expect(sent).toContain("sécurisation automatique");
    expect(sent).toContain("/trial");
    vi.useRealTimers();
  });
});

/**
 * Le rappel COMBLE les silences du canal. À 3h d'intervalle sur une plage de
 * 16h il partirait 5 fois par jour : un message identique répété cinq fois
 * est exactement le spam qu'on cherche à éliminer.
 */
describe("Le rappel de canal ne double pas le contenu existant", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("se tait si un signal vient d'être publié sur le canal", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 12, 0)));
    let sends = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("channel_posts")) return jsonResponse([{ reference: "signal:1" }]);
        if (url.includes("api.telegram.org")) {
          sends++;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await postChannelReminder(env);
    expect(sends).toBe(0);
  });

  it("se tait aussi si c'est la LISTE DU JOUR qui vient de passer", async () => {
    // LE DOUBLON QUOTIDIEN DU CANAL PUBLIC, corrigé le 13/08/2026.
    //
    // Ce rappel n'interrogeait que la table `signals` : la liste du jour, les
    // clôtures et les posts pédagogiques lui étaient invisibles. Le canal a
    // donc publié le 12/08 :
    //
    //   10:27  LA LISTE DU JOUR — CONDITION D'ENTRÉE : fermée
    //          Le Bitcoin est 9,0 % sous sa moyenne 200 jours.
    //   23:30  Le Bitcoin est sous sa moyenne 200 jours : la force relative ne
    //          prend plus de position.
    //
    // Le même fait, deux fois le même jour, la seconde en moins précis. Le
    // filtre est fermé depuis novembre 2025 : ce doublon se répétait TOUS LES
    // JOURS.
    //
    // CE TEST A VALIDÉ LE GARDE-FOU CONTRE UNE LIGNE QUI N'EXISTAIT PAS. Il
    // simulait une entrée `channel_posts` pour la liste du jour — mais la
    // liste du jour est publiée depuis Python et n'écrivait rien dans cette
    // table. Le garde-fou était donc correct, sa donnée d'entrée absente, et
    // le doublon décrit ci-dessus restait entièrement possible en production.
    // `signals/watchlist.py` journalise depuis le 17/08/2026 ; la référence
    // ci-dessous est celle qu'il écrit réellement.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 12, 0)));
    let sends = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("channel_posts")) return jsonResponse([{ reference: "liste-du-jour" }]);
        if (url.includes("api.telegram.org")) {
          sends++;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await postChannelReminder(env);
    expect(sends, "le rappel a double la liste du jour").toBe(0);
  });

  it("ne se tait PAS à cause de son propre rappel précédent", async () => {
    // Le garde-fou ne doit pas s'auto-bloquer : sans cette exclusion, un
    // premier rappel empêcherait tous les suivants et le canal deviendrait
    // muet pendant les longues fermetures du filtre.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 12, 0)));
    let sends = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("channel_posts")) return jsonResponse([{ reference: "rappel-filtre-ferme" }]);
        if (url.includes("api.telegram.org")) {
          sends++;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await postChannelReminder(env);
    expect(sends).toBeGreaterThan(0);
  });

  it("parle quand le canal est resté silencieux", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 2, 12, 0)));
    let sends = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("channel_posts")) return jsonResponse([]); // canal silencieux
        if (url.includes("api.telegram.org")) {
          sends++;
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );

    await postChannelReminder(env);
    expect(sends).toBe(1);
  });
});
