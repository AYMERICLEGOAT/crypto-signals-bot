/**
 * Suivi post-trade des carrys de financement.
 *
 * Pourquoi un suivi séparé de trackSignalOutcomes. Celui-ci clôture un signal
 * quand le prix touche un stop ou un objectif, ou après expiration. Un carry
 * n'a ni stop ni objectif : c'est une position NEUTRE AU MARCHÉ, composée d'un
 * achat au comptant et d'une vente à découvert du perpétuel pour le même
 * montant. Quand le prix bouge, une jambe gagne exactement ce que l'autre perd.
 *
 * Le passer dans le suivi par prix produirait deux erreurs graves :
 *   - il serait clôturé sur un mouvement de cours qui ne lui fait rien ;
 *   - le résultat inscrit serait la variation du prix, c'est-à-dire un chiffre
 *     qui n'a aucun rapport avec ce que l'abonné a réellement gagné.
 *
 * Ce que mesure ce suivi, à la place : le FINANCEMENT réellement encaissé entre
 * l'ouverture et la clôture, moins les frais des deux jambes. C'est le seul
 * résultat qui a un sens ici, et c'est ce qui est écrit dans
 * `carry_realized_pct` (voir init.sql section 46).
 *
 * La clôture est purement TEMPORELLE : elle survient quand `hold_until` est
 * dépassé, jamais avant, jamais sur un prix.
 */

import { Env, dbConfig } from "../env";
import { getOpenCarrySignals, SignalRecord } from "../db/signals";
import { getDeliveryRecipients } from "../db/signalDeliveries";
import { getFundingCollectedPct } from "../market/funding";
import { updateRows } from "../supabaseRest";
import { sendMessage } from "../telegram";

// Frais des deux jambes, à l'ouverture comme à la fermeture : 0,10 %
// l'aller-retour par jambe. Doit rester aligné sur
// signals/config.py::CARRY_ROUND_TRIP_COST_PCT, sinon le résultat annoncé à
// l'abonné ne correspondrait pas à celui utilisé pour choisir la position.
const ROUND_TRIP_COST_PCT = 0.2;

// Stop sur le financement CUMULÉ, en pourcentage négatif. Doit rester aligné
// sur signals/config.py::CARRY_STOP_FUNDING_PCT.
//
// Ce n'est pas un stop de prix : la position y est insensible. C'est le seul
// garde-fou contre l'inversion du financement lors d'un squeeze, où ce sont les
// vendeurs de perpétuels qui paient, parfois pendant plusieurs jours.
const STOP_FUNDING_PCT = -1.5;

const BATCH_SIZE = 25;
const DELAY_BETWEEN_BATCHES_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} %`;
}

function buildCloseMessage(signal: SignalRecord, realized: number, attendu: number | null, parLeStop = false): string {
  const gagnant = realized > 0;
  const lines = [
    `${gagnant ? "✅" : "🔻"} *Carry clôturé — ${signal.pair}*`,
    "",
    `💵 Financement encaissé, frais déduits : *${formatPct(realized)}*`,
  ];

  if (parLeStop) {
    lines.push(
      "",
      "⛔ *Clôture anticipée.* Le financement s'est inversé : au lieu de l'encaisser, la position le payait. C'est ce qui arrive lors d'un mouvement violent, quand les vendeurs de perpétuels deviennent majoritaires.",
      "On ferme au lieu d'attendre le terme — c'est ce garde-fou qui empêche une position de ce type de dériver."
    );
  }

  if (attendu != null) {
    const ecart = realized - attendu;
    lines.push(`📊 Annoncé à l'ouverture : ${formatPct(attendu)} (écart ${formatPct(ecart)})`);
    // L'écart est dit dans les deux sens. Ne le mentionner que lorsqu'il est
    // favorable transformerait l'annonce d'ouverture en promesse implicite,
    // alors que sur 6 ans seules 41 % des positions atteignent le montant
    // annoncé — le taux de financement bouge pendant la détention.
    if (ecart < -0.05) {
      lines.push("Le taux de financement a baissé pendant la détention : c'est le risque normal de cette stratégie, pas un incident.");
    }
  }

  lines.push(
    "",
    "Referme bien les *deux* jambes ensemble : la vente du perpétuel et l'achat au comptant. N'en garder qu'une transformerait une position neutre en pari directionnel.",
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital."
  );
  return lines.join("\n");
}

async function notifyRecipients(env: Env, db: ReturnType<typeof dbConfig>, signal: SignalRecord, message: string): Promise<void> {
  // Mêmes destinataires que pour un signal classique : ceux qui l'ont
  // RÉELLEMENT reçu, pas les abonnés actifs au moment de la clôture — un
  // utilisateur a pu changer de plan entre-temps.
  //
  // Aucun filtre de préférence ici, comme pour trackSignalOutcomes : la
  // clôture d'une position qu'on a soi-même ouverte n'est pas du contenu
  // optionnel, c'est l'information sans laquelle l'abonné garde une position
  // ouverte sans le savoir. Les préférences existantes couvrent les contenus
  // périphériques (alertes momentum, posts pédagogiques, récap hebdomadaire).
  const telegramIds = await getDeliveryRecipients(db, signal.id);
  if (telegramIds.length === 0) return;

  for (let i = 0; i < telegramIds.length; i += BATCH_SIZE) {
    const lot = telegramIds.slice(i, i + BATCH_SIZE);
    await Promise.all(
      lot.map((id) =>
        sendMessage(env.TELEGRAM_BOT_TOKEN, id, message, { markdown: true }).catch((err) =>
          console.error(`[carry] Échec de notification de clôture à ${id}:`, err)
        )
      )
    );
    if (i + BATCH_SIZE < telegramIds.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }
}

export async function trackCarryOutcomes(env: Env): Promise<void> {
  const db = dbConfig(env);
  const nowIso = new Date().toISOString();

  let ouvertes: SignalRecord[];
  try {
    ouvertes = await getOpenCarrySignals(db);
  } catch (err) {
    // Tant que la migration de la section 46 d'init.sql n'est pas appliquée,
    // la colonne hold_until n'existe pas et cette requête échoue. Ce n'est pas
    // une panne : c'est l'état normal avant migration, et aucun carry ne peut
    // exister non plus. On le dit une fois et on sort.
    console.error("[carry] Suivi impossible (colonne hold_until absente ? migration section 46 non appliquée) :", err);
    return;
  }
  if (ouvertes.length === 0) return;

  console.log(`[carry] ${ouvertes.length} carry(s) ouvert(s) à examiner.`);

  for (const signal of ouvertes) {
    const startMs = new Date(signal.created_at).getTime();
    const echeanceMs = signal.hold_until ? new Date(signal.hold_until).getTime() : Date.now();
    const maintenant = Date.now();
    // Le financement est mesuré jusqu'à MAINTENANT, pas jusqu'à l'échéance :
    // c'est ce qui permet de détecter une position qui coûte déjà trop cher
    // avant son terme.
    const endMs = Math.min(echeanceMs, maintenant);

    const collected = await getFundingCollectedPct(signal.pair, startMs, endMs);
    if (collected === null) {
      // Aucune source de financement n'a répondu. On NE clôture pas : inscrire
      // un résultat sans donnée reviendrait à inventer un chiffre que l'abonné
      // prendrait pour argent comptant. La position sera reprise au prochain
      // cycle, ce qui ne coûte que du retard.
      console.error(`[carry] ${signal.pair} : financement indisponible, clôture reportée au prochain cycle.`);
      continue;
    }

    const echue = maintenant >= echeanceMs;
    const touchéeParLeStop = collected <= STOP_FUNDING_PCT;

    // Une position qui n'est ni échue ni au stop continue de courir : on ne
    // fait que la mesurer, sans rien écrire.
    if (!echue && !touchéeParLeStop) continue;

    const realized = collected - ROUND_TRIP_COST_PCT;
    const outcome: "WIN" | "LOSS" = realized > 0 ? "WIN" : "LOSS";
    const raison = touchéeParLeStop ? "carry_stop" : "carry_expired";

    try {
      await updateRows(db, "signals", { id: `eq.${signal.id}` }, {
        outcome,
        close_reason: raison,
        carry_realized_pct: Number(realized.toFixed(4)),
        evaluated_at: nowIso,
        // `outcome_price` reste nul : une position neutre au marché n'a pas de
        // prix de sortie qui décrive son résultat. Y écrire le cours du moment
        // ferait apparaître un faux gain ou une fausse perte dans tous les
        // récapitulatifs qui lisent cette colonne.
      });
    } catch (err) {
      console.error(`[carry] Échec d'enregistrement de la clôture de ${signal.pair} (#${signal.id}) :`, err);
      continue;
    }

    console.log(
      `[carry] ${signal.pair} clôturé : ${realized.toFixed(3)} % net ` +
        `(financement ${collected.toFixed(3)} %, frais ${ROUND_TRIP_COST_PCT} %), annoncé ${signal.carry_expected_pct ?? "?"} %.`
    );

    await notifyRecipients(
      env,
      db,
      { ...signal, outcome, carry_realized_pct: realized },
      buildCloseMessage(signal, realized, signal.carry_expected_pct ?? null, touchéeParLeStop)
    );
  }
}
