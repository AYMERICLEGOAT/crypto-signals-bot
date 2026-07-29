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
  stop_loss: number;
  take_profit: number;
  created_at: string;
  confidence_score?: number | null;
  tp1_price?: number | null;
  tp2_price?: number | null;
  tp3_price?: number | null;
  /** Moteur d'origine (voir signals/squeeze_engine.py) -- absent ou "high_confidence" pour les signaux du moteur historique EMA/RSI 1h. */
  engine?: string | null;
}

const ENGINE_BADGE: Record<string, string> = {
  high_confidence: "🎯 Haute Confiance",
  squeeze_15m: "⚡ Squeeze 15M",
};

function engineBadge(engine?: string | null): string {
  return ENGINE_BADGE[engine ?? "high_confidence"] ?? ENGINE_BADGE.high_confidence;
}

function pct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** Libellé FR pour un côté de signal — à utiliser partout au lieu du "BUY"/"SELL" brut, qui fuitait en anglais dans plusieurs messages de suivi. */
export function typeLabel(type: SignalSide): string {
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
function buildMultiTpLines(signal: SignalLike): string[] {
  const pctOf = (level: number) =>
    signal.type === "BUY" ? ((level - signal.entry_price) / signal.entry_price) * 100 : ((signal.entry_price - level) / signal.entry_price) * 100;
  const slDist = Math.abs(signal.entry_price - signal.stop_loss);
  const ratioLabel = (level: number) => (slDist > 0 ? ` (ratio 1:${(Math.abs(level - signal.entry_price) / slDist).toFixed(1)})` : "");

  const lines = [`🛑 Stop-Loss : ${signal.stop_loss} (${pct(-Math.abs(pctOf(signal.stop_loss)))})`];
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

function buildTrailingStopLine(signal: SignalLike): string {
  const risk = Math.abs(signal.entry_price - signal.stop_loss);
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
  const emoji = signal.type === "BUY" ? "🟢" : "🔴";
  const label = typeLabel(signal.type);
  const rewardPct = signal.type === "BUY"
    ? ((signal.take_profit - signal.entry_price) / signal.entry_price) * 100
    : ((signal.entry_price - signal.take_profit) / signal.entry_price) * 100;
  const riskPct = signal.type === "BUY"
    ? ((signal.entry_price - signal.stop_loss) / signal.entry_price) * 100
    : ((signal.stop_loss - signal.entry_price) / signal.entry_price) * 100;

  const escapedUsername = opts.ctaUsername?.replace(/_/g, "\\_");
  const riskSizingLine = buildRiskSizingLine(signal.entry_price, signal.stop_loss);
  const isMultiTp = signal.tp1_price != null;

  const lines: Array<string | null> = [
    `${emoji} *${label} ${signal.pair}* — ${engineBadge(signal.engine)}${opts.delayNote ? ` _(${opts.delayNote})_` : ""}`,
    buildContext(signal.type, signal.engine),
    "",
    `💵 Zone d'entrée : ${signal.entry_price}`,
    ...(isMultiTp
      ? buildMultiTpLines(signal)
      : [`🎯 Take profit : ${signal.take_profit} (${pct(rewardPct)})`, `🛑 Stop loss : ${signal.stop_loss} (${pct(-riskPct)})`]),
    "",
    riskSizingLine,
    opts.trailingEnabled ? buildTrailingStopLine(signal) : null,
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
