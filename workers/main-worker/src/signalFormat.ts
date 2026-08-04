/**
 * UX — format de signal unifié (contexte simple, risque conseillé 2%, émojis).
 * Utilisé par cron/dispatchSignals.ts, cron/dispatchStandardTier.ts,
 * cron/dispatchPublicChannel.ts et bot/commands/demo.ts : un seul endroit à
 * faire évoluer, plutôt que 4 copies qui divergent avec le temps.
 *
 * Le trailing stop (voir signalMath.ts::computeTrailingStop) est purement
 * indicatif et n'apparaît que pour les destinataires ayant activé la
 * préférence (paramètre `trailingEnabled`) — jamais sur le canal public, qui
 * n'a pas de destinataire individuel à qui s'adresser.
 */

import { SignalSide } from "./signalMath";

export const SUGGESTED_RISK_PCT = 2;

export interface SignalLike {
  type: SignalSide;
  pair: string;
  entry_price: number;
  // Nuls uniquement pour un CARRY, qui n'a ni stop ni objectif (voir
  // buildCarryMessage). Tous les moteurs directionnels les renseignent.
  stop_loss: number | null;
  take_profit: number | null;
  created_at: string;
  confidence_score?: number | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp3_price?: number | null;
  /** Moteur d'origine (voir signals/squeeze_engine.py) -- absent ou "high_confidence" pour les signaux du moteur historique EMA/RSI 1h. */
  engine?: string | null;
  /** Carry uniquement : financement net attendu sur la durée de détention, frais déduits. */
  carry_expected_pct?: number | null;
  /** Carry uniquement : date de clôture prévue. La sortie est temporelle, aucun prix ne la déclenche. */
  hold_until?: string | null;
}

const ENGINE_BADGE: Record<string, string> = {
  high_confidence: "🎯 Haute Confiance",
  squeeze_15m: "⚡ Squeeze 15M",
  relative_strength: "📈 Force Relative",
  carry_funding: "💵 Carry de Financement",
};

function engineBadge(engine?: string | null): string {
  return ENGINE_BADGE[engine ?? "high_confidence"] ?? ENGINE_BADGE.high_confidence;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** Libellé FR pour un côté de signal — à utiliser partout au lieu du "BUY"/"SELL" brut, qui fuitait en anglais dans plusieurs messages de suivi. */
export function typeLabel(type: SignalSide): string {
  if (type === "CARRY") return "CARRY";
  return type === "BUY" ? "ACHAT" : "VENTE";
}

function buildContext(type: SignalSide, engine?: string | null): string {
  const arrow = type === "BUY" ? "📈" : "📉";
  const direction = type === "BUY" ? "haussière" : "baissière";
  if (engine === "squeeze_15m") {
    return `${arrow} Signal Squeeze 15M : cassure ${direction} après une phase de compression de volatilité, confirmée par le volume.`;
  }
  return `${arrow} Signal Haute Confiance : la tendance vient de basculer ${direction} (EMA + RSI + ADX alignés).`;
}

function buildRiskSizingLine(entryPrice: number, stopLoss: number): string | null {
  const riskPct = (Math.abs(entryPrice - stopLoss) / entryPrice) * 100;
  if (riskPct <= 0) return null;
  const positionPct = Math.min(100, (SUGGESTED_RISK_PCT / riskPct) * 100);
  const capNote = (SUGGESTED_RISK_PCT / riskPct) * 100 > 100 ? " (mise maximale recommandée)" : "";
  return (
    `💰 Risque conseillé : ${SUGGESTED_RISK_PCT}% de ton capital max sur ce trade. ` +
    `Avec un stop à ${riskPct.toFixed(1)}% de l'entrée, cela correspond à une position d'environ ` +
    `${positionPct.toFixed(0)}% de ton capital alloué à ce trade${capNote} (${SUGGESTED_RISK_PCT}% ÷ ${riskPct.toFixed(1)}%).`
  );
}

/**
 * Mission "grille d'excellence" — gestion Multi-TP avec sécurisation
 * Break-Even (voir signals/config.py::ENABLE_MULTI_TP_EXITS). Le ratio
 * risque/rendement affiché est calculé dynamiquement à partir des prix
 * réels du signal (distance TPn / distance stop) plutôt qu'affiché en dur :
 * les deux moteurs (Haute Confiance et Squeeze 15M, voir
 * signals/squeeze_engine.py) utilisent des multiplicateurs ATR différents,
 * un texte fixe aurait été faux pour l'un des deux.
 */
function buildMultiTpLines(signal: SignalLike, stopLoss: number): string[] {
  const pctOf = (level: number) =>
    signal.type === "BUY" ? ((level - signal.entry_price) / signal.entry_price) * 100 : ((signal.entry_price - level) / signal.entry_price) * 100;
  const slDist = Math.abs(signal.entry_price - stopLoss);
  const ratioLabel = (level: number) => (slDist > 0 ? ` (ratio 1:${(Math.abs(level - signal.entry_price) / slDist).toFixed(1)})` : "");

  const lines = [`🛑 Stop-Loss : ${stopLoss} (${pct(-Math.abs(pctOf(stopLoss)))})`];
  if (signal.tp1_price != null) {
    lines.push(
      `🥇 TP1 : ${signal.tp1_price} (${pct(pctOf(signal.tp1_price))}${ratioLabel(signal.tp1_price)}) — Sécurisation rapide + passage automatique au Break-Even`
    );
  }
  if (signal.tp2_price != null) {
    lines.push(`🥈 TP2 : ${signal.tp2_price} (${pct(pctOf(signal.tp2_price))}${ratioLabel(signal.tp2_price)}) — Objectif principal`);
  }
  if (signal.tp3_price != null) {
    lines.push(`🥉 TP3 : ${signal.tp3_price} (${pct(pctOf(signal.tp3_price))}${ratioLabel(signal.tp3_price)}) — Runner`);
  }
  return lines;
}

function buildTrailingStopLine(signal: SignalLike, stopLoss: number): string {
  const risk = Math.abs(signal.entry_price - stopLoss);
  const firstTrailPrice = signal.type === "BUY" ? signal.entry_price + risk : signal.entry_price - risk;
  return (
    `🔒 Trailing stop activé : dès que le prix atteint ${firstTrailPrice.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} ` +
    `(+1R), tu recevras un message pour remonter ton stop au point mort (${signal.entry_price}). Purement indicatif.`
  );
}

export function buildSignalMessage(
  signal: SignalLike,
  opts: { trailingEnabled?: boolean; delayNote?: string; ctaUsername?: string } = {}
): string {
  // Un carry n'a ni stop ni objectif : tous les calculs de risque/rendement
  // ci-dessous porteraient sur des champs nuls et produiraient des NaN affichés
  // aux abonnés. Il a son propre message, qui explique les deux jambes.
  if (signal.type === "CARRY") {
    return buildCarryMessage(signal, opts);
  }

  const emoji = signal.type === "BUY" ? "🟢" : "🔴";
  const label = typeLabel(signal.type);

  // Passé la branche CARRY ci-dessus, stop et objectif sont nécessairement
  // renseignés : la base ne les autorise nuls que pour les carrys, et tous les
  // moteurs directionnels les fixent. Le repli à 0 n'existe que pour satisfaire
  // le typage — s'il apparaissait dans un message, ce serait le signe d'une
  // insertion anormale, visible immédiatement.
  const stopLoss = signal.stop_loss ?? 0;
  const takeProfit = signal.take_profit ?? 0;

  const rewardPct = signal.type === "BUY"
    ? ((takeProfit - signal.entry_price) / signal.entry_price) * 100
    : ((signal.entry_price - takeProfit) / signal.entry_price) * 100;
  const riskPct = signal.type === "BUY"
    ? ((signal.entry_price - stopLoss) / signal.entry_price) * 100
    : ((stopLoss - signal.entry_price) / signal.entry_price) * 100;

  const escapedUsername = opts.ctaUsername?.replace(/_/g, "\\_");
  const riskSizingLine = buildRiskSizingLine(signal.entry_price, stopLoss);
  const isMultiTp = signal.tp1_price != null;

  const lines: Array<string | null> = [
    `${emoji} *${label} ${signal.pair}* — ${engineBadge(signal.engine)}${opts.delayNote ? ` _(${opts.delayNote})_` : ""}`,
    buildContext(signal.type, signal.engine),
    "",
    `💵 Zone d'entrée : ${signal.entry_price}`,
    ...(isMultiTp
      ? buildMultiTpLines(signal, stopLoss)
      : [`🎯 Take profit : ${takeProfit} (${pct(rewardPct)})`, `🛑 Stop loss : ${stopLoss} (${pct(-riskPct)})`]),
    "",
    riskSizingLine,
    opts.trailingEnabled ? buildTrailingStopLine(signal, stopLoss) : null,
    signal.confidence_score != null ? `📊 Confiance : ${signal.confidence_score}/100 _(indicatif, pas une probabilité de gain)_` : null,
    `🕒 ${new Date(signal.created_at).toLocaleString("fr-FR")}`,
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital.",
  ];

  if (escapedUsername) {
    lines.push("", `📡 Signaux en temps réel + alertes VIP : rejoins @${escapedUsername}`);
  }

  return lines.filter((line): line is string => line !== null).join("\n");
}


/**
 * Message d'un carry de financement.
 *
 * Ce que l'abonné doit comprendre, et qui n'a aucun équivalent dans les autres
 * signaux : ce n'est PAS un pari sur le prix. Il ouvre deux positions de même
 * montant, en sens opposé, sur la même crypto. Si le prix monte, la jambe spot
 * gagne exactement ce que la jambe perpétuelle perd. Ce qu'il encaisse, c'est
 * le financement — ce taux versé toutes les 8 heures par les acheteurs de
 * perpétuels aux vendeurs.
 *
 * Trois honnêtetés obligatoires dans ce message, mesurées et non négociables :
 *   - le montant annoncé n'est PAS acquis. Sur 6 ans, seules 41 % des positions
 *     atteignent le financement annoncé à l'ouverture (corrélation annoncé /
 *     réalisé : +0,49). Le taux peut baisser, voire s'inverser.
 *   - ce n'est pas « sans risque » : la jambe vendeuse peut être liquidée si la
 *     marge devient insuffisante, et il reste un risque de plateforme.
 *   - la position se ferme sur une DURÉE. Aucun prix ne la déclenchera.
 *
 * Aucun `parse_mode` particulier n'est imposé ici : la fonction rend du Markdown
 * comme buildSignalMessage, et les noms de paires ne contiennent pas de tiret bas.
 */
export function buildCarryMessage(
  signal: SignalLike,
  opts: { delayNote?: string; ctaUsername?: string } = {}
): string {
  // Le tiret bas doit être échappé pour Telegram : un underscore nu dans un
  // message Markdown ouvre une mise en italique et casse le message ENTIER.
  // Le nom du bot en contient un.
  const escapedUsername = opts.ctaUsername?.replace(/_/g, "\\_");
  const attendu = signal.carry_expected_pct;
  const jours = signal.hold_until
    ? Math.max(1, Math.round((new Date(signal.hold_until).getTime() - new Date(signal.created_at).getTime()) / 86400000))
    : null;

  const lines: Array<string | null> = [
    `💵 *CARRY ${signal.pair}* — ${engineBadge(signal.engine)}${opts.delayNote ? ` _(${opts.delayNote})_` : ""}`,
    "Position neutre au marché : le prix peut monter ou baisser, ça ne change rien au résultat.",
    "",
    "*Les deux jambes, à ouvrir en même temps et pour le même montant :*",
    `🟢 Achat au comptant (spot) de ${signal.pair}`,
    `🔴 Vente à découvert du perpétuel ${signal.pair}`,
    "",
    `💵 Prix de référence : ${signal.entry_price}`,
    attendu != null ? `📈 Financement net attendu : ${attendu >= 0 ? "+" : ""}${attendu.toFixed(2)} % sur la période, frais déduits` : null,
    jours != null ? `⏳ Clôture prévue dans ${jours} jours — les deux jambes se ferment ensemble` : null,
    "",
    "*Comment ça gagne.* Les acheteurs de perpétuels versent un financement aux vendeurs toutes les 8 heures. En étant vendeur du perpétuel, tu l'encaisses. Comme ta position spot compense exactement la position perpétuelle, le prix n'entre pas dans l'équation.",
    "",
    "*Ce que tu dois savoir avant d'ouvrir :*",
    "• Le montant annoncé n'est pas acquis. Sur 6 ans, 41 % des positions ont atteint ou dépassé le montant annoncé à l'ouverture — le taux de financement bouge, et peut s'inverser.",
    "• Ce n'est pas sans risque : ta jambe vendeuse peut être liquidée si ta marge devient insuffisante. Garde de la marge disponible.",
    "• Il faut fermer les DEUX jambes en même temps. N'en garder qu'une transforme une position neutre en pari directionnel.",
    "",
    `🕒 ${new Date(signal.created_at).toLocaleString("fr-FR")}`,
    "",
    "⚠️ Pas un conseil financier — risque de perte en capital.",
  ];

  if (escapedUsername) {
    lines.push("", `📡 Signaux en temps réel + alertes VIP : rejoins @${escapedUsername}`);
  }

  return lines.filter((line): line is string => line !== null).join("\n");
}
