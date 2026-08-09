/**
 * Comparaison à temps constant (Bloc 8) pour le secret du webhook Telegram
 * (index.ts) : `!==` sur des chaînes s'arrête au premier caractère différent,
 * ce qui fuite en théorie la longueur du préfixe correct via le temps de
 * réponse. Boucle toujours sur la longueur maximale, jamais de retour
 * anticipé sur un mismatch.
 */
export function timingSafeEqual(a: string | undefined, b: string | undefined): boolean {
  // NE JAMAIS LEVER D'EXCEPTION SUR UNE VALEUR ABSENTE.
  //
  // La signature promettait deux `string`, mais TELEGRAM_WEBHOOK_SECRET est
  // optionnel dans Env : secret jamais posé, faute de frappe, rotation ratée.
  // `undefined.length` levait alors un TypeError qui remontait jusqu'au
  // handler fetch et transformait « refuser la requête » en erreur 500 — le
  // bot devenait muet et le symptôme ressemblait à une panne d'infrastructure
  // plutôt qu'à une configuration manquante.
  //
  // Une valeur absente n'est égale à rien, pas même à une autre absente : deux
  // secrets non configurés ne doivent surtout pas s'authentifier mutuellement.
  if (typeof a !== "string" || typeof b !== "string") return false;

  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;

  for (let i = 0; i < maxLength; i++) {
    const charA = i < a.length ? a.charCodeAt(i) : 0;
    const charB = i < b.length ? b.charCodeAt(i) : 0;
    diff |= charA ^ charB;
  }

  return diff === 0;
}
