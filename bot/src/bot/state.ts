/**
 * État conversationnel minimal en mémoire : quel input texte libre on attend
 * de chaque utilisateur (ex: une adresse wallet après avoir choisi USDT).
 * Volontairement simple (pas de scenes Telegraf) — en cas de redémarrage du
 * bot, l'utilisateur perd juste sa saisie en cours (aucune perte de données
 * métier : paiements/abonnements restent dans Supabase).
 */

export type PendingAction = { type: "awaiting_wallet_usdt"; plan: 1 | 2 } | { type: "awaiting_wallet_trial" };

const pendingActions = new Map<number, PendingAction>();

export function setPendingAction(telegramId: number, action: PendingAction): void {
  pendingActions.set(telegramId, action);
}

export function consumePendingAction(telegramId: number): PendingAction | undefined {
  const action = pendingActions.get(telegramId);
  pendingActions.delete(telegramId);
  return action;
}
