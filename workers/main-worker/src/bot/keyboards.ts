import { InlineKeyboard } from "../telegram";

export const startKeyboard: InlineKeyboard = [
  [{ text: "📅 S'abonner", callback_data: "start:subscribe" }],
  [{ text: "🎁 Essai gratuit (3 jours)", callback_data: "start:trial" }],
  [{ text: "📊 Mon statut", callback_data: "start:status" }],
];

export const planKeyboard: InlineKeyboard = [
  [{ text: "Plan 1 — 10 USDT / 30j", callback_data: "plan:1" }],
  [{ text: "Plan 2 — 25 USDT / 30j", callback_data: "plan:2" }],
];

export function paymentMethodKeyboard(plan: 1 | 2): InlineKeyboard {
  return [
    [{ text: "💵 USDT (Polygon)", callback_data: `pay:USDT:${plan}` }],
    [{ text: "🟠 Monero (XMR)", callback_data: `pay:XMR:${plan}` }],
    [{ text: "⚪ Litecoin (LTC)", callback_data: `pay:LTC:${plan}` }],
  ];
}
