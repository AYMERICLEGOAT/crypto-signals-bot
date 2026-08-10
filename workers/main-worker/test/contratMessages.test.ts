import { describe, it, expect } from "vitest";
import {
  buildSignalMessage,
  buildCarryMessage,
  buildCarryShortMessage,
  buildCarryBatchMessage,
  buildPublicTeaserMessage,
  buildCarryExplanation,
  buildCarryDetailKeyboard,
} from "../src/signalFormat";
import { splitMessage, CAPTION_MAX } from "../src/telegram";

/**
 * LE CONTRAT QUE TOUT MESSAGE DOIT RESPECTER POUR ÊTRE DÉLIVRÉ.
 *
 * Ce fichier ne teste pas ce que disent les messages — d'autres s'en chargent.
 * Il teste qu'ils PARTENT, ce qui est une question différente et qui a coûté
 * cher : les quatre signaux des 9 et 10/08/2026 étaient parfaitement rédigés,
 * marqués « envoyés », et n'ont atteint personne. Telegram les avait refusés.
 *
 * Cette famille de pannes est invisible : le message est construit sans erreur,
 * l'API répond 400, l'appelant attrape et journalise, et le produit continue
 * comme si de rien n'était. Aucun test de contenu ne l'attrape.
 *
 * Trois causes possibles de refus, vérifiées ici sur TOUTE la matrice des
 * messages du produit — trois types de signal × cinq moteurs, plus les carrys :
 *
 *   1. Markdown historique mal apparié. Un seul `*` ou `_` non fermé fait
 *      rejeter le message ENTIER avec « can't parse entities ». Le nom du bot
 *      contient un underscore, ce qui rend le piège permanent.
 *   2. Longueur. 4096 pour un message, 1024 pour une légende de photo.
 *   3. Message vide, que l'API refuse aussi.
 */

/** Compte les délimiteurs Markdown NON échappés d'un texte. */
function delimiteursNonEchappes(texte: string, delim: string): number {
  let n = 0;
  for (let i = 0; i < texte.length; i++) {
    if (texte[i] !== delim) continue;
    // Un délimiteur précédé d'un antislash est littéral, pas une entité.
    let antislashes = 0;
    for (let j = i - 1; j >= 0 && texte[j] === "\\"; j--) antislashes++;
    if (antislashes % 2 === 0) n++;
  }
  return n;
}

/**
 * Telegram exige des paires. Un compte impair signifie une entité ouverte et
 * jamais fermée — et le message entier part à la poubelle.
 */
function markdownEstApparie(texte: string): boolean {
  return (
    delimiteursNonEchappes(texte, "*") % 2 === 0 &&
    delimiteursNonEchappes(texte, "_") % 2 === 0 &&
    delimiteursNonEchappes(texte, "`") % 2 === 0
  );
}

const MOTEURS = [
  "relative_strength",
  "cassure_canal",
  "expansion_volatilite",
  "momentum_4h",
  "carry_funding",
  "high_confidence",
  "moteur_inconnu",
  "",
] as const;

/** Le nom réel du bot, avec son underscore — la source du piège Markdown. */
const BOT = "ProVIPSignals_bot";

function signalDirectionnel(engine: string, type: "BUY" | "SELL") {
  return {
    type,
    pair: "ICP/USDT",
    entry_price: 2.2,
    stop_loss: type === "BUY" ? 2.06437058 : 2.33562942,
    take_profit: type === "BUY" ? 2.47125884 : 1.9,
    tp1_price: 2.33562942,
    tp2_price: 2.47125884,
    tp3_price: 2.60688826,
    created_at: "2026-08-09T02:21:09Z",
    engine,
    hold_until: "2026-08-12T02:21:09Z",
  } as never;
}

function signalCarry(over: Record<string, unknown> = {}) {
  return {
    type: "CARRY",
    pair: "HMSTR/USDT",
    entry_price: 0.0001977,
    stop_loss: null,
    take_profit: null,
    created_at: "2026-08-09T02:21:09Z",
    engine: "carry_funding",
    carry_expected_pct: 0.57,
    hold_until: "2026-08-30T02:21:09Z",
    ...over,
  } as never;
}

/** Chaque cas : un nom lisible, le texte, et s'il part en parse_mode Markdown. */
const CAS: { nom: string; texte: string; markdown: boolean }[] = [];

for (const engine of MOTEURS) {
  for (const type of ["BUY", "SELL"] as const) {
    CAS.push({
      nom: `signal ${type} — ${engine || "(moteur vide)"}`,
      texte: buildSignalMessage(signalDirectionnel(engine, type)),
      markdown: true,
    });
    CAS.push({
      nom: `signal ${type} avec CTA — ${engine || "(moteur vide)"}`,
      texte: buildSignalMessage(signalDirectionnel(engine, type), { ctaUsername: BOT, trailingEnabled: true }),
      markdown: true,
    });
    CAS.push({
      nom: `teaser public ${type} — ${engine || "(moteur vide)"}`,
      texte: buildPublicTeaserMessage(signalDirectionnel(engine, type), {
        botUsername: BOT,
        delayNote: "signal différé de 15 h — détecté cette nuit, publié à la réouverture du canal",
      }),
      markdown: true,
    });
  }
}

CAS.push({ nom: "carry complet", texte: buildCarryMessage(signalCarry(), { ctaUsername: BOT }), markdown: true });
CAS.push({ nom: "carry sans rendement", texte: buildCarryMessage(signalCarry({ carry_expected_pct: null })), markdown: true });
CAS.push({ nom: "carry court", texte: buildCarryShortMessage([signalCarry()]), markdown: true });
CAS.push({ nom: "carry en lot", texte: buildCarryBatchMessage([signalCarry(), signalCarry({ pair: "ZEC/USDT" })], { ctaUsername: BOT }), markdown: true });
CAS.push({ nom: "carry en lot d'un seul", texte: buildCarryBatchMessage([signalCarry()], { ctaUsername: BOT }), markdown: true });
CAS.push({ nom: "explication du carry", texte: buildCarryExplanation(), markdown: true });

describe("Contrat de délivrabilité — tous les messages du produit", () => {
  it("la matrice couvre bien tous les moteurs et les deux sens", () => {
    // Sans cette garde, une régression pourrait vider CAS et rendre toute la
    // suite verte sans rien vérifier.
    expect(CAS.length).toBeGreaterThanOrEqual(MOTEURS.length * 6);
  });

  it.each(CAS.map((c) => [c.nom, c] as const))("%s — Markdown apparié", (_nom, cas) => {
    // LE PIÈGE HISTORIQUE DE CE PROJET. Un `_` non échappé dans le nom du bot
    // a déjà fait rejeter des messages entiers, en silence.
    if (!cas.markdown) return;
    expect(markdownEstApparie(cas.texte), `entités non appariées :\n${cas.texte.slice(0, 300)}`).toBe(true);
  });

  it.each(CAS.map((c) => [c.nom, c] as const))("%s — jamais vide", (_nom, cas) => {
    expect(cas.texte.trim().length).toBeGreaterThan(0);
  });

  it.each(CAS.map((c) => [c.nom, c] as const))("%s — découpage sans morceau invalide", (_nom, cas) => {
    // Un message de plus de 4096 caractères est découpé. Chaque morceau doit
    // rester délivrable pris isolément.
    for (const morceau of splitMessage(cas.texte)) {
      expect(morceau.length).toBeLessThanOrEqual(4096);
      expect(morceau.length).toBeGreaterThan(0);
    }
  });
});

describe("Les légendes de photo, qui ont fait perdre quatre signaux", () => {
  it("un signal complet DÉPASSE la limite de légende — c'est le fait de départ", () => {
    // Si cette assertion tombait un jour, ce serait que le message a fondu :
    // le correctif resterait correct, mais la raison de son existence
    // mériterait d'être revérifiée.
    const texte = buildSignalMessage(signalDirectionnel("momentum_4h", "BUY"), { ctaUsername: BOT });
    expect(texte.length).toBeGreaterThan(CAPTION_MAX);
  });

  it("un teaser public, lui, tient en légende", () => {
    const texte = buildPublicTeaserMessage(signalDirectionnel("momentum_4h", "BUY"), { botUsername: BOT });
    expect(texte.length).toBeLessThanOrEqual(CAPTION_MAX);
  });
});

describe("Les claviers", () => {
  it("chaque bouton porte un callback_data OU une url, jamais ni l'un ni l'autre", () => {
    // Telegram rejette la requête entière si un bouton n'a aucune action —
    // et le message avec.
    for (const rangee of buildCarryDetailKeyboard(BOT)) {
      for (const bouton of rangee) {
        const b = bouton as { text: string; callback_data?: string; url?: string };
        expect(b.text.trim().length, "bouton sans libellé").toBeGreaterThan(0);
        expect(Boolean(b.callback_data) || Boolean(b.url), `bouton « ${b.text} » sans action`).toBe(true);
      }
    }
  });
});
