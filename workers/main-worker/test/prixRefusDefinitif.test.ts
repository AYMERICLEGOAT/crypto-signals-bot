import { describe, it, expect, vi, afterEach } from "vitest";
import { getCurrentPrices } from "../src/market/binancePrices";
import { reinitialiserJournalUneFois } from "../src/utils/logUneFois";

/**
 * BINANCE RÉPOND 403 AU WORKER, ET C'EST PERMANENT.
 *
 * Observé en production le 10/08/2026 dans les journaux du cron `*​/5` :
 *
 *   (error) [post-trade] Échec de récupération des prix Binance,
 *           bascule sur Kraken/Coinbase: Error: Binance ticker/price a répondu 403
 *
 * Binance bloque les plages d'IP d'hébergeurs, dont celles de Cloudflare. Ce
 * n'est pas un incident : c'est le régime permanent de ce déploiement.
 *
 * Le client réessayait pourtant TROIS fois, avec 400 puis 800 ms d'attente,
 * avant de passer au repli. Trois sous-requêtes et 1,2 seconde jetées à chaque
 * cycle de cinq minutes — 288 fois par jour — dans une chaîne dont la limite de
 * cinquante sous-requêtes par invocation est le point de rupture connu de ce
 * projet : c'est elle qui a tué huit tâches pendant cinq jours.
 *
 * Le suivi post-trade dépend de ces prix. Gaspiller le budget avant même
 * d'atteindre le repli, c'est risquer de ne clôturer aucun signal.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

interface Options {
  /** Statut rendu par Binance. */
  statutBinance: number;
}

function stub(opts: Options) {
  const appels: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      appels.push(url);
      if (url.includes("binance")) return new Response("blocked", { status: opts.statutBinance });
      if (url.includes("kraken")) {
        return jsonResponse({ error: [], result: { SOLUSDT: { c: ["186.42"] } } });
      }
      return jsonResponse({ price: "186.42" });
    })
  );
  return { appels, binance: () => appels.filter((u) => u.includes("binance")).length };
}

describe("Un refus définitif ne se réessaie pas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    reinitialiserJournalUneFois();
  });

  it("appelle Binance UNE SEULE FOIS sur un 403", async () => {
    // La propriété qui compte : deux sous-requêtes récupérées par cycle.
    const s = stub({ statutBinance: 403 });
    await getCurrentPrices(["SOL/USDT"]);
    expect(s.binance(), "Binance a été réessayé alors que 403 est définitif").toBe(1);
  });

  it("bascule quand même sur Kraken et rend le prix", async () => {
    // Échouer vite ne doit pas vouloir dire échouer tout court : le repli est
    // la vraie réponse, et il doit partir immédiatement.
    const s = stub({ statutBinance: 403 });
    const prix = await getCurrentPrices(["SOL/USDT"]);
    expect(prix["SOLUSDT"]).toBeCloseTo(186.42);
    expect(s.appels.some((u) => u.includes("kraken"))).toBe(true);
  });

  it("réessaie en revanche un 429, qui est transitoire", async () => {
    // La distinction est tout l'objet du correctif. Une limite de débit passe ;
    // un blocage de plage d'IP ne passe pas. Les confondre coûte soit des
    // sous-requêtes, soit un prix perdu pour rien.
    const s = stub({ statutBinance: 429 });
    await getCurrentPrices(["SOL/USDT"]);
    expect(s.binance()).toBeGreaterThan(1);
  }, 15000);

  it("ne journalise le 403 qu'une fois par HEURE, pas à chaque cycle", async () => {
    // Une ligne identique toutes les cinq minutes noie le journal — c'est ce
    // qui a rendu invisible la panne de paiement pendant des jours.
    //
    // La première version de ce test vérifiait une déduplication en mémoire.
    // Elle passait, et la production journalisait quand même à chaque cycle :
    // 19:55 puis 20:00, deux invocations de cron consécutives. Chaque
    // déclenchement repart d'un isolat neuf, donc la Map est toujours vide.
    // Un test vert sur un mécanisme qui ne s'exécute jamais deux fois.
    //
    // Le contrat est donc horaire et sans état : seul le premier cycle de
    // chaque heure journalise. Ce test le vérifie sur l'horloge, la seule
    // chose qui survive au recyclage de l'isolat.
    const erreurs: string[] = [];
    const espion = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
      erreurs.push(a.map(String).join(" "));
    });
    stub({ statutBinance: 403 });

    vi.useFakeTimers();
    try {
      // Les onze cycles de 20:05 à 20:55 : silence complet.
      for (let m = 5; m < 60; m += 5) {
        vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 20, m)));
        await getCurrentPrices(["SOL/USDT"]);
      }
      expect(erreurs.filter((l) => l.includes("403")), "une ligne est partie en cours d'heure").toHaveLength(0);

      // 21:00 : le fait réapparaît. Il ne doit jamais DISPARAÎTRE du journal.
      vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 21, 0)));
      await getCurrentPrices(["SOL/USDT"]);
      expect(erreurs.filter((l) => l.includes("403"))).toHaveLength(1);
    } finally {
      vi.useRealTimers();
      espion.mockRestore();
    }
  });
});
