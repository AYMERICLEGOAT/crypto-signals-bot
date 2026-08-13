import { describe, it, expect, vi, afterEach } from "vitest";
import { trackSignalOutcomes } from "../src/cron/trackSignalOutcomes";

/**
 * Deux comportements ajoutés à la clôture, et le second est surtout une
 * interdiction.
 *
 * 1. Le canal gratuit publiait déjà les niveaux d'origine, mais sans jamais
 *    dire QUAND les abonnés les avaient reçus. Le lecteur voyait des chiffres
 *    sans comprendre qu'il les découvrait avec plusieurs jours de retard —
 *    c'est-à-dire sans comprendre ce qu'il n'a pas.
 *
 * 2. Le bloc de parrainage n'était attaché qu'aux clôtures TP3, le cas le plus
 *    rare du produit. Il accompagne désormais TOUT gain — et JAMAIS une perte.
 *    Demander de partager un trade perdant serait absurde ; rappeler le bonus
 *    au pire moment se lirait comme de l'indécence.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const env = {
  TELEGRAM_BOT_TOKEN: "fake",
  TELEGRAM_BOT_USERNAME: "ProVIPSignals_bot",
  TELEGRAM_CHANNEL_ID: "-100111",
  SUPABASE_URL: "https://fake.test",
  SUPABASE_KEY: "k",
} as any;

/**
 * Signal ouvert depuis 3 jours, échéance dépassée -> clôture à l'échéance.
 *
 * Le prix des tests reste ENTRE l'entrée et TP1 : le moteur multi-TP n'avance
 * que d'un palier par passage, si bien qu'un prix franchissant TP1, TP2 et TP3
 * d'un coup marque seulement TP1 et sort de la boucle SANS clôturer. C'est le
 * comportement normal du produit, et il rendait ces tests muets.
 *
 * `tp1_hit_at` décide alors du résultat : déjà sécurisé -> gain, sinon perte.
 */
function signalExpire(over: Record<string, unknown> = {}) {
  const ilYA3Jours = new Date(Date.now() - 3 * 86_400_000).toISOString();
  return {
    id: 1,
    pair: "BTC/USDT",
    type: "BUY",
    entry_price: 100,
    stop_loss: 90,
    take_profit: 120,
    tp1_price: 110,
    tp2_price: 115,
    tp3_price: 120,
    tp1_hit_at: null,
    created_at: ilYA3Jours,
    hold_until: new Date(Date.now() - 60_000).toISOString(),
    sent_to_channel: true,
    outcome: null,
    ...over,
  };
}

interface Options {
  signal?: Record<string, unknown>;
  prix?: number;
  /** Clôture déjà enregistrée en base mais jamais publiée sur le canal — vue par le rattrapage. */
  clotureManquante?: Record<string, unknown>;
}

/**
 * LE BOUCHON RESPECTE `select`, ET C'EST LA MOITIÉ DE CE FICHIER.
 *
 * Il rendait la ligne entière quelle que soit la projection demandée. Un
 * appelant pouvait donc lire une colonne qu'il n'avait pas sélectionnée : le
 * test passait, la production recevait `undefined`. C'est arrivé — le
 * rattrapage des clôtures (voir republierCloturesManquees) réutilisait une
 * requête qui ne rend que quatre colonnes et ne pouvait rien republier, sans
 * une seule ligne d'erreur.
 *
 * Projeter réellement transforme cette classe de bug en échec de test.
 */
function projeter(ligne: Record<string, unknown>, url: string): Record<string, unknown> {
  const select = new URL(url).searchParams.get("select");
  if (!select || select === "*") return ligne;
  const colonnes = select.split(",").map((c) => c.trim());
  return Object.fromEntries(colonnes.filter((c) => c in ligne).map((c) => [c, ligne[c]]));
}

function stub(opts: Options = {}) {
  const messages: { chatId: string; text: string }[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("api.telegram.org")) {
        const b = JSON.parse(init!.body as string);
        messages.push({ chatId: String(b.chat_id), text: String(b.text ?? "") });
        return jsonResponse({ ok: true, result: { message_id: 1 } });
      }
      // Le rattrapage interroge les signaux DÉJÀ clôturés ; le suivi normal
      // interroge les signaux ouverts. Deux requêtes distinctes sur la même
      // table, que le bouchon doit distinguer sous peine de faire republier
      // chaque test par le rattrapage.
      if (url.includes("/signals") && url.includes("outcome=not.is.null")) {
        return jsonResponse(opts.clotureManquante ? [projeter(opts.clotureManquante, url)] : []);
      }
      if (url.includes("/signals") && (!init || init.method === undefined)) {
        return jsonResponse([projeter(opts.signal ?? signalExpire(), url)]);
      }
      if (url.includes("signal_deliveries")) return jsonResponse([{ telegram_id: 42 }]);
      if (url.includes("channel_posts") && (!init || init.method === undefined)) return jsonResponse([]);
      if (url.includes("binance") || url.includes("kraken") || url.includes("coinbase")) {
        return jsonResponse([{ symbol: "BTCUSDT", price: String(opts.prix ?? 130) }]);
      }
      return jsonResponse([]);
    })
  );
  return { messages };
}

const canalPublic = (m: { chatId: string; text: string }[]) => m.filter((x) => x.chatId === "-100111");
const enPrive = (m: { chatId: string; text: string }[]) => m.filter((x) => x.chatId === "42");

describe("L'asymétrie est énoncée sur la clôture publique", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("dit depuis combien de jours les abonnés avaient les niveaux", async () => {
    const { messages } = stub({ prix: 105 });
    await trackSignalOutcomes(env);
    const publics = canalPublic(messages);
    expect(publics.length).toBeGreaterThan(0);
    expect(publics[0].text).toMatch(/Les abonnés avaient ces niveaux il y a \d+ jour/);
  });

  it("compte les jours RÉELLEMENT écoulés, pas la durée prévue", async () => {
    // Un signal de 7 jours clôturé au 3e jour ne doit pas annoncer « 7 jours ».
    const { messages } = stub({
      signal: signalExpire({
        created_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        hold_until: new Date(Date.now() - 60_000).toISOString(),
      }),
      prix: 105,
    });
    await trackSignalOutcomes(env);
    expect(canalPublic(messages)[0].text).toContain("il y a 3 jour(s)");
  });

  it("l'énonce aussi sur une clôture PERDANTE", async () => {
    // La différence de calendrier existe quel que soit le résultat, et le
    // canal gratuit doit la comprendre sur les pertes comme sur les gains.
    //
    // 95 pour une entrée à 100, pas 105. Ces tests utilisaient un prix
    // SUPÉRIEUR à l'entrée pour décrire une perte — ils encodaient le défaut
    // qui a fait publier « ❌ perdant / sortie à 204.35 (+0.3%) » le 12/08.
    const { messages } = stub({ prix: 95 });
    await trackSignalOutcomes(env);
    const publics = canalPublic(messages);
    expect(publics[0].text).toMatch(/perdant/i);
    expect(publics[0].text).toMatch(/Les abonnés avaient ces niveaux/);
  });
});

describe("Une clôture refusée par l'espacement repart au passage suivant", () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * LE 10/08, LA CLÔTURE #26 A ÉTÉ PERDUE POUR TOUJOURS.
   *
   * Les signaux #25 et #26 sont arrivés à échéance à la même minute. Le premier
   * a été publié à 16:45, le second refusé par l'espacement de vingt minutes —
   * et comme `markSignalClosed` s'exécute AVANT `peutPublier`, il n'est jamais
   * repassé dans la boucle des signaux ouverts. Le refus valait suppression.
   *
   * C'est la promesse centrale du canal gratuit qui tombait : « chaque signal
   * est republié ici à sa clôture, gagnant ou perdant ».
   */
  const clotureeNonPubliee = () =>
    signalExpire({
      id: 26,
      pair: "ALGO/USDT",
      outcome: "LOSS",
      outcome_price: 95,
      close_reason: "expired",
      evaluated_at: new Date(Date.now() - 3_600_000).toISOString(),
    });

  it("republie une clôture absente de channel_posts", async () => {
    const { messages } = stub({ clotureManquante: clotureeNonPubliee(), prix: 105 });
    await trackSignalOutcomes(env);
    expect(canalPublic(messages).some((m) => m.text.includes("ALGO/USDT"))).toBe(true);
  });

  it("lit RÉELLEMENT les colonnes qu'elle demande", async () => {
    // Le premier correctif réutilisait une requête projetant quatre colonnes :
    // ni `id`, ni `sent_to_channel`. Il ne pouvait rien republier, en silence.
    // Le bouchon projette maintenant comme PostgREST : si une colonne lue n'est
    // pas demandée, le message sort avec « undefined » et ce test tombe.
    const { messages } = stub({ clotureManquante: clotureeNonPubliee(), prix: 105 });
    await trackSignalOutcomes(env);
    const republie = canalPublic(messages).find((m) => m.text.includes("ALGO/USDT"));
    expect(republie).toBeDefined();
    expect(republie!.text).not.toContain("undefined");
    expect(republie!.text).not.toContain("NaN");
    expect(republie!.text).toContain("Entrée");
  });

  it("ne republie rien quand la clôture figure déjà dans channel_posts", async () => {
    // Sans cette garantie, le canal republierait la même clôture toutes les
    // cinq minutes — un dégât pire que l'oubli qu'on répare.
    const messages: { chatId: string; text: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("api.telegram.org")) {
          const b = JSON.parse(init!.body as string);
          messages.push({ chatId: String(b.chat_id), text: String(b.text ?? "") });
          return jsonResponse({ ok: true, result: { message_id: 1 } });
        }
        if (url.includes("/signals") && url.includes("outcome=not.is.null")) {
          return jsonResponse([projeter(clotureeNonPubliee(), url)]);
        }
        if (url.includes("/signals")) return jsonResponse([]);
        if (url.includes("channel_posts")) return jsonResponse([{ reference: "cloture:26", sent_at: new Date().toISOString() }]);
        return jsonResponse([]);
      })
    );
    await trackSignalOutcomes(env);
    expect(messages.filter((m) => m.text.includes("ALGO/USDT"))).toHaveLength(0);
  });
});

describe("Les prix de la clôture sont arrondis comme ceux du signal", () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * L'ARRONDI AVAIT ÉTÉ CORRIGÉ AU MAUVAIS ENDROIT.
   *
   * `prix()` avait été branché sur le message de signal — celui que l'abonné
   * reçoit — et nulle part ailleurs. La clôture, elle, republie les MÊMES
   * niveaux sur le canal public, en interpolant les colonnes brutes. Résultat :
   * le même trade sortait avec « 2.0644 » à l'ouverture et « 2.06437058 » à la
   * fermeture, dans deux messages que le lecteur peut comparer à l'écran.
   *
   * Ce test lit le message tel qu'il part réellement, parce que c'est la seule
   * façon de garantir que la correction ne se reperdra pas au prochain
   * changement de formulation.
   */
  const signalHuitDecimales = () =>
    signalExpire({
      pair: "ICP/USDT",
      entry_price: 2.2,
      stop_loss: 2.06437058,
      take_profit: 2.60688826,
      tp1_price: 2.33562942,
      tp2_price: 2.47125884,
      tp3_price: 2.60688826,
    });

  it("ne republie aucun niveau à huit décimales", async () => {
    const { messages } = stub({ signal: signalHuitDecimales(), prix: 2.25 });
    await trackSignalOutcomes(env);
    const texte = [...canalPublic(messages), ...enPrive(messages)].map((m) => m.text).join("\n");
    expect(texte.length).toBeGreaterThan(0);
    expect(texte).not.toContain("2.06437058");
    expect(texte).not.toContain("2.33562942");
    expect(texte).not.toContain("2.60688826");
    expect(texte).toContain("2.0644");
  });

  it("n'écrit nulle part un nombre à plus de huit décimales", async () => {
    // Le filet large : un prix oublié dans une formulation future se ferait
    // prendre ici même sans que ce test connaisse la phrase concernée.
    const { messages } = stub({ signal: signalHuitDecimales(), prix: 2.25 });
    await trackSignalOutcomes(env);
    for (const m of [...canalPublic(messages), ...enPrive(messages)]) {
      expect(m.text, m.text).not.toMatch(/\d+\.\d{9,}/);
    }
  });
});

describe("Le parrainage accompagne les gains, et JAMAIS les pertes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("est proposé sur un gain à l'échéance, pas seulement sur TP3", async () => {
    // C'était le défaut : seul TP3, le cas le plus rare, déclenchait le bloc.
    const { messages } = stub({ signal: signalExpire({ tp1_hit_at: new Date().toISOString() }), prix: 105 });
    await trackSignalOutcomes(env);
    const prives = enPrive(messages);
    expect(prives.length).toBeGreaterThan(0);
    expect(prives.some((m) => /À partager si tu veux/.test(m.text))).toBe(true);
  });

  it("N'EST JAMAIS proposé sur une perte", async () => {
    // Demander de partager un trade perdant serait absurde, et rappeler le
    // bonus au pire moment se lirait comme de l'indécence.
    // 95 : sous l'entrée, donc une VRAIE perte (voir la note ci-dessus).
    const { messages } = stub({ prix: 95 });
    await trackSignalOutcomes(env);
    for (const m of enPrive(messages)) {
      expect(m.text).not.toMatch(/À partager si tu veux/);
      expect(m.text).not.toMatch(/filleul/i);
    }
  });

  it("ne fuite jamais dans le canal public : le lien est personnel", async () => {
    // buildReferralLink est propre à un telegram_id. Le publier sur un canal
    // attribuerait les filleuls de tout le monde à une seule personne.
    const { messages } = stub({ signal: signalExpire({ tp1_hit_at: new Date().toISOString() }), prix: 105 });
    await trackSignalOutcomes(env);
    for (const m of canalPublic(messages)) {
      expect(m.text).not.toMatch(/À partager si tu veux/);
    }
  });
});
