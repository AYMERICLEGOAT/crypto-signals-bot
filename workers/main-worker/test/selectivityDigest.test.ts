import { describe, it, expect, vi, afterEach } from "vitest";
import { dispatchSelectivityDigest } from "../src/cron/dispatchSelectivityDigest";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake-token",
  SUPABASE_URL: "https://fake-supabase.test",
  SUPABASE_KEY: "k",
  TELEGRAM_CHANNEL_ID: "-100111",
  TELEGRAM_VIP_CHANNEL_ID: "-100222",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
} as any;

/**
 * CE BILAN SE CONTREDISAIT TOUS LES JOURS, SUR LE CANAL D'ACQUISITION.
 *
 * Il comptait les configurations « écartées » à partir de la table
 * `momentum_alerts`. Le moteur qui les produisait a été désactivé le 03/08
 * après avoir été mesuré comme la jambe PERDANTE de la stratégie ; dernière
 * alerte en base : 03/08 23:13. Depuis, le canal public recevait chaque jour :
 *
 *   2 configuration(s) examinée(s) sur 40 paires :
 *   ✅ 2 signal(aux) émis
 *   🚫 0 écartée(s) — critères non réunis
 *
 * Un taux d'acceptation de 100 % publié sous un titre qui annonce la
 * sélectivité, et « 2 examinées » alors que les 40 paires sont balayées à
 * chaque cycle. Le message démontrait l'inverse de ce qu'il affirmait, devant
 * exactement le public qu'il devait convaincre.
 *
 * L'ancienne version de ce fichier VALIDAIT cette formulation : elle vérifiait
 * « 6 configuration(s) examinée(s) » à partir de rejets fabriqués dans le
 * bouchon. Un test vert sur une phrase fausse, parce qu'il testait la mise en
 * forme et jamais le fait.
 */
describe("Bilan de sélectivité", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubDigest(emitted: unknown[], onSend: (chatId: string, text: string) => void) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("system_heartbeats")) return jsonResponse([]);
        if (url.includes("/signals")) return jsonResponse(emitted);
        if (url.includes("api.telegram.org")) {
          const b = JSON.parse(init!.body as string);
          onSend(String(b.chat_id), b.text);
          return jsonResponse({ ok: true, result: {} });
        }
        return jsonResponse([]);
      })
    );
  }

  it("ne publie AUCUN compte de rejets", async () => {
    // La propriété centrale. Ce compte ne peut plus être établi honnêtement :
    // sa source est tarie, et une soustraction « 40 − émis » serait fausse
    // puisque le carry puise dans un univers plus large que les 40 paires.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 19, 0)));
    let text = "";
    stubDigest([{ id: 1 }, { id: 2 }], (_c, t) => (text = t));

    await dispatchSelectivityDigest(env);

    expect(text).not.toMatch(/écartée/i);
    expect(text).not.toMatch(/examinée/i);
    expect(text).not.toMatch(/\b0 /);
  });

  it("énonce l'univers balayé et le nombre retenu", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 19, 0)));
    const sent: { chat: string; text: string }[] = [];
    stubDigest([{ id: 1 }, { id: 2 }], (chat, text) => sent.push({ chat, text }));

    await dispatchSelectivityDigest(env);

    expect(sent).toHaveLength(1); // un seul message par jour
    expect(sent[0].chat).toBe("-100111");
    expect(sent[0].text).toContain("40 paires analysées");
    expect(sent[0].text).toContain("2 signal(aux) retenu(s)");
  });

  it("présente une journée sans signal comme un résultat, pas comme une panne", async () => {
    // C'est le cas le plus fréquent maintenant que la stratégie est
    // sélective, et le seul où le silence pourrait passer pour une panne.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 19, 0)));
    let text = "";
    stubDigest([], (_c, t) => (text = t));

    await dispatchSelectivityDigest(env);
    expect(text).toContain("c'est un résultat, pas une panne");
  });

  it("publie même un jour sans signal", async () => {
    // L'ancienne version se taisait quand rien n'avait été « examiné ». Or un
    // jour sans signal est précisément le jour où le canal doit expliquer son
    // silence — sinon le lecteur conclut que le service est mort.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 19, 0)));
    let sends = 0;
    stubDigest([], () => sends++);
    await dispatchSelectivityDigest(env);
    expect(sends).toBe(1);
  });

  it("ne publie pas avant l'heure du bilan", async () => {
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 10, 0)));
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    await dispatchSelectivityDigest(env);
    expect(spy).not.toHaveBeenCalled();
  });

  it("échappe l'underscore du nom du bot", async () => {
    // ProVIPSignals_bot en Markdown legacy : un underscore non échappé fait
    // REJETER le message entier par Telegram, pas seulement mal l'afficher.
    vi.setSystemTime(new Date(Date.UTC(2026, 7, 10, 19, 0)));
    let text = "";
    stubDigest([{ id: 1 }], (_c, t) => (text = t));
    await dispatchSelectivityDigest(env);
    expect(text).toContain("ProVIPSignals\\_bot");
  });
});
