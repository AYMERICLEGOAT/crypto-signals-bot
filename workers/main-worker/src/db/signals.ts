import { SupabaseConfig, selectRows, updateRows } from "../supabaseRest";

export interface SignalRecord {
  id: number;
  pair: string;
  type: "BUY" | "SELL" | "CARRY";
  entry_price: number;
  // Nuls pour un carry : la position est neutre au marché et se ferme sur une
  // durée, aucun niveau de prix ne la menace ni ne la déclenche.
  stop_loss: number | null;
  take_profit: number | null;
  created_at: string;
  sent: boolean;
  chart_url: string | null;
  sent_to_channel: boolean;
  sent_to_standard: boolean;
  outcome: "WIN" | "LOSS" | null;
  outcome_price: number | null;
  close_reason: "tp_hit" | "sl_hit" | "expired" | null;
  confidence_score: number | null;
  trailing_stop_price: number | null;
  // Mission "grille d'excellence" — optionnels pour rester compatibles avec
  // les signaux/fixtures de test créés avant l'ajout du Multi-TP (absence =
  // signal classique SL/TP unique, voir signalMath.ts::evaluateMultiTpProgress).
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp3_price?: number | null;
  // Carry uniquement (voir signals/carry_engine.py et init.sql section 46).
  carry_expected_pct?: number | null;
  carry_realized_pct?: number | null;
  hold_until?: string | null;
  tp1_hit_at?: string | null;
  tp2_hit_at?: string | null;
  tp3_hit_at?: string | null;
  breakeven_active?: boolean;
  /** Moteur d'origine (voir signals/squeeze_engine.py) -- "high_confidence" par défaut (colonne SQL non nullable). */
  engine?: string;
}

export async function getUnsentSignals(db: SupabaseConfig): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", { sent: "eq.false", order: "created_at.asc" });
}

export async function markSignalSent(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { sent: true });
}

/**
 * Signaux déjà envoyés à la vitesse "Pro" (immédiate), plus vieux que
 * `olderThanMinutes` (délai de l'Effet Sniper — Bloc 2.2), pas encore
 * diffusés aux abonnés Standard/Découverte.
 */
export async function getSignalsDueForStandardTier(
  db: SupabaseConfig,
  olderThanMinutes: number,
  limit = 20
): Promise<SignalRecord[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
  return selectRows<SignalRecord>(db, "signals", {
    sent_to_standard: "eq.false",
    created_at: `lte.${cutoff}`,
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markSentToStandard(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { sent_to_standard: true });
}

/**
 * Signaux déjà envoyés aux abonnés, plus vieux que `olderThanMinutes` (le
 * délai du canal public gratuit), et pas encore diffusés sur ce canal.
 * Limité à `limit` par appel pour ne pas rattraper des centaines de
 * signaux d'un coup si le cron a été arrêté un moment.
 */
export async function getSignalsDueForPublicChannel(
  db: SupabaseConfig,
  olderThanMinutes: number,
  limit = 20
): Promise<SignalRecord[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
  return selectRows<SignalRecord>(db, "signals", {
    sent_to_channel: "eq.false",
    created_at: `lte.${cutoff}`,
    order: "created_at.asc",
    limit: String(limit),
  });
}

export async function markSentToChannel(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { sent_to_channel: true });
}

/**
 * Signaux déjà envoyés (au moins aux abonnés Pro/essai) et pas encore
 * résolus (Bloc 4 — suivi post-trade). Filtre aussi sur `outcome=is.null` en
 * plus de `close_reason` : le site SEO (website/outcome_evaluator.py) peut
 * résoudre un signal en premier (rare, cadence quotidienne vs 5 min ici) —
 * dans ce cas `outcome` est déjà posé et on ne doit pas le réévaluer, même
 * si `close_reason` (propre à ce Worker) est resté vide.
 */
export async function getOpenSignals(db: SupabaseConfig): Promise<SignalRecord[]> {
  const rows = await selectRows<SignalRecord>(db, "signals", {
    sent: "eq.true",
    outcome: "is.null",
    order: "created_at.asc",
  });
  // Les carrys sont EXCLUS du suivi par prix. Une position neutre au marché ne
  // peut pas toucher un stop ni un objectif — elle n'en a pas — et les laisser
  // ici les ferait clôturer à tort sur un simple mouvement de cours, en
  // inscrivant un résultat qui ne correspond à rien. Ils sont suivis par
  // cron/trackCarryOutcomes.ts, qui mesure le financement encaissé.
  //
  // Le filtrage se fait ici et non dans la requête : en PostgREST,
  // `engine=not.eq.carry_funding` élimine AUSSI les lignes dont `engine` est
  // nul (la comparaison rend NULL, donc faux), ce qui exclurait du suivi tous
  // les signaux antérieurs à l'introduction de cette colonne.
  return rows.filter((s) => s.engine !== "carry_funding");
}

/**
 * TOUS les carrys encore ouverts, échus ou non.
 *
 * Le suivi ne peut pas se contenter des positions arrivées à échéance : le
 * financement d'un perpétuel peut s'INVERSER en cours de route — lors d'un
 * squeeze, ce sont les vendeurs qui paient. Une position ouverte pour encaisser
 * 0,03 %/jour se met alors à en coûter dix fois plus, et rien ne l'arrêterait
 * jusqu'au terme. Le stop sur financement cumulé (voir trackCarryOutcomes) doit
 * donc pouvoir fermer AVANT `hold_until`, ce qui suppose d'examiner chaque
 * position à chaque passage.
 *
 * Mesuré : sans ce stop, la pire position atteint -66,70 % ; avec, -19,86 %,
 * pour une espérance qui MONTE de +0,656 % à +0,761 % — il ne coupe pas de
 * gagnantes, seules 1,7 % des positions le déclenchent.
 */
export async function getOpenCarrySignals(db: SupabaseConfig): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", {
    engine: "eq.carry_funding",
    outcome: "is.null",
    order: "created_at.asc",
  });
}

/** Bloc 9 — y a-t-il eu un vrai signal dans les `hours` dernières heures ? (statut "aucun signal aujourd'hui"). */
/** BLOC 21 (/guide) — le tout dernier signal émis, tous statuts confondus, pour un exemple concret. */
export async function getLatestSignal(db: SupabaseConfig): Promise<SignalRecord | null> {
  const rows = await selectRows<SignalRecord>(db, "signals", { order: "created_at.desc", limit: "1" });
  return rows[0] ?? null;
}

export async function hasRecentSignal(db: SupabaseConfig, hours: number): Promise<boolean> {
  const threshold = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await selectRows<{ id: number }>(db, "signals", {
    created_at: `gte.${threshold}`,
    select: "id",
    limit: "1",
  });
  return rows.length > 0;
}

/** Bloc 12.3 — récap hebdomadaire : signaux émis depuis `sinceIso`. */
export async function getSignalsCreatedSince(db: SupabaseConfig, sinceIso: string): Promise<SignalRecord[]> {
  // `created_at` est sélectionné en plus de `id` : la relance post-expiration
  // (cron/reengagementOffer.ts) compte les signaux partis après l'expiration
  // PROPRE à chaque personne, et sans cette colonne le filtre comparerait des
  // dates indéfinies — il aurait silencieusement compté zéro à chaque fois.
  return selectRows<SignalRecord>(db, "signals", { created_at: `gte.${sinceIso}`, select: "id,created_at" });
}

/** Bloc 12.3 — récap hebdomadaire : signaux résolus (TP/SL/expiré) depuis `sinceIso`. */
/**
 * IL MANQUAIT `outcome` DANS SA PROPRE PROJECTION, et ça a produit un message
 * arithmétiquement impossible sur le canal payant.
 *
 * Le briefing VIP du 11/08/2026 annonçait :
 *
 *   📊 Dernières 24 h : 4 clôture(s)
 *   ✅ 0 gagnante(s) — ❌ 0 perdante(s)
 *
 * Quatre clôtures dont aucune n'est ni gagnante ni perdante. L'appelant
 * comptait `s.outcome === "WIN"` sur des lignes où la colonne n'avait jamais
 * été demandée : `undefined` des deux côtés, donc zéro des deux côtés. Rien
 * n'échoue, rien n'est journalisé, et l'abonné payant lit une absurdité.
 *
 * Même classe de défaut que le rattrapage des clôtures, trouvée le même jour :
 * TypeScript type la ligne entière, PostgREST n'en rend qu'une partie, et
 * l'écart ne se voit qu'en production.
 *
 * Les niveaux TP sont là pour permettre le calcul du rendement réel, sorties
 * partielles comprises (voir trackSignalOutcomes::pnlEffectif).
 */
export async function getSignalsResolvedSince(db: SupabaseConfig, sinceIso: string): Promise<SignalRecord[]> {
  return selectRows<SignalRecord>(db, "signals", {
    evaluated_at: `gte.${sinceIso}`,
    outcome: "not.is.null",
    select:
      "id,pair,type,entry_price,outcome,outcome_price,close_reason," +
      "tp1_price,tp2_price,tp3_price,tp1_hit_at,tp2_hit_at,tp3_hit_at",
  });
}

/**
 * UX — trailing stop optionnel (voir signalMath.ts::computeTrailingStop) :
 * met à jour UNIQUEMENT le niveau indicatif affiché aux abonnés ayant activé
 * la préférence. Ne touche jamais stop_loss/take_profit/outcome (voir note
 * section 31 d'init.sql).
 */
export async function updateTrailingStop(db: SupabaseConfig, id: number, trailingStopPrice: number): Promise<void> {
  await updateRows(db, "signals", { id: `eq.${id}` }, { trailing_stop_price: trailingStopPrice });
}

/**
 * Mission "grille d'excellence" — TP1 atteint : sécurise
 * MULTI_TP_TP1_WEIGHT de la position (voir signals/config.py) et remonte le
 * stop au prix d'entrée. À partir de là, ce signal ne peut plus se clôturer
 * en perte (voir signalMath.ts::evaluateMultiTpProgress).
 */
export async function markTp1Hit(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(
    db,
    "signals",
    { id: `eq.${id}` },
    { tp1_hit_at: new Date().toISOString(), breakeven_active: true, last_status_update_at: new Date().toISOString() }
  );
}

/** TP2 atteint : sécurise une tranche supplémentaire, le stop reste au break-even (inchangé depuis TP1). */
export async function markTp2Hit(db: SupabaseConfig, id: number): Promise<void> {
  await updateRows(
    db,
    "signals",
    { id: `eq.${id}` },
    { tp2_hit_at: new Date().toISOString(), last_status_update_at: new Date().toISOString() }
  );
}

export async function markSignalClosed(
  db: SupabaseConfig,
  id: number,
  outcome: { outcome: "WIN" | "LOSS"; outcomePrice: number | null; closeReason: "tp_hit" | "sl_hit" | "expired" }
): Promise<void> {
  const now = new Date().toISOString();
  await updateRows(
    db,
    "signals",
    { id: `eq.${id}` },
    {
      outcome: outcome.outcome,
      outcome_price: outcome.outcomePrice,
      close_reason: outcome.closeReason,
      evaluated_at: now,
      last_status_update_at: now,
    }
  );
}
