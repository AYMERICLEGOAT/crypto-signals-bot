const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** Découpe un message trop long en plusieurs morceaux valides pour l'API Telegram. */
export function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
