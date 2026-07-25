/**
 * Comparaison à temps constant (Bloc 8) pour le secret du webhook Telegram
 * (index.ts) : `!==` sur des chaînes s'arrête au premier caractère différent,
 * ce qui fuite en théorie la longueur du préfixe correct via le temps de
 * réponse. Boucle toujours sur la longueur maximale, jamais de retour
 * anticipé sur un mismatch.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  for (let i = 0; i < maxLength; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    diff |= charA ^ charB;
  }

  return diff === 0;
}
