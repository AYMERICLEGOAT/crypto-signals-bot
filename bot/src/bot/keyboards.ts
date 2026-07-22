import { Markup } from "telegraf";

export const startKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("📅 S'abonner", "start:subscribe")],
  [Markup.button.callback("🎁 Essai gratuit (3 jours)", "start:trial")],
  [Markup.button.callback("📊 Mon statut", "start:status")],
]);

export const planKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("Plan 1 — 10 USDT / 30j", "plan:1")],
  [Markup.button.callback("Plan 2 — 25 USDT / 30j", "plan:2")],
]);

export function paymentMethodKeyboard(plan: 1 | 2) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("💵 USDT (Polygon)", `pay:USDT:${plan}`)],
    [Markup.button.callback("🟠 Monero (XMR)", `pay:XMR:${plan}`)],
    [Markup.button.callback("⚪ Litecoin (LTC)", `pay:LTC:${plan}`)],
  ]);
}
