/**
 * Attente asynchrone. Utilisé par la séquence /start (voir
 * bot/commands/start.ts) pour espacer ses messages dans le temps sans
 * bloquer le webhook : l'appel entier tourne déjà dans un ctx.waitUntil()
 * posé par index.ts, donc cette attente prolonge simplement cette tâche de
 * fond au lieu de retarder la réponse "ok" renvoyée à Telegram.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
