/**
 * Client HTTP minimal supportant l'authentification Digest (RFC 7616),
 * utilisée par monero-wallet-rpc quand il est lancé avec `--rpc-login`.
 * `node:crypto` (createHash md5) est disponible sous Workers via le flag
 * `nodejs_compat` — vérifié empiriquement (vecteur de test RFC 1321).
 */

import crypto from "node:crypto";

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
}

function parseDigestHeader(header: string): DigestChallenge {
  const clean = header.replace(/^Digest\s+/i, "");
  const result: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]*)"|([^,\s]*))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(clean))) {
    result[match[1]] = match[2] !== undefined ? match[2] : match[3];
  }
  return result as unknown as DigestChallenge;
}

function md5(input: string): string {
  return crypto.createHash("md5").update(input).digest("hex");
}

let cnonceCounter = 0;

export async function digestAuthFetch(
  url: string,
  options: { method: string; body: string; username: string; password: string }
): Promise<Response> {
  const uri = new URL(url).pathname || "/";

  const firstAttempt = await fetch(url, {
    method: options.method,
    headers: { "Content-Type": "application/json" },
    body: options.body,
  });

  if (firstAttempt.status !== 401) {
    return firstAttempt; // --rpc-login désactivé côté wallet-rpc
  }

  const authHeader = firstAttempt.headers.get("www-authenticate");
  if (!authHeader) {
    throw new Error("monero-wallet-rpc a renvoyé 401 sans en-tête WWW-Authenticate exploitable");
  }

  const challenge = parseDigestHeader(authHeader);
  const nc = "00000001";
  const cnonce = md5(`${Date.now()}-${cnonceCounter++}`).slice(0, 16);
  const qop = challenge.qop?.split(",")[0]?.trim() || "auth";

  const ha1 = md5(`${options.username}:${challenge.realm}:${options.password}`);
  const ha2 = md5(`${options.method}:${uri}`);
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  const authValue =
    `Digest username="${options.username}", realm="${challenge.realm}", ` +
    `nonce="${challenge.nonce}", uri="${uri}", qop=${qop}, nc=${nc}, cnonce="${cnonce}", ` +
    `response="${response}"` +
    (challenge.opaque ? `, opaque="${challenge.opaque}"` : "");

  return fetch(url, {
    method: options.method,
    headers: { "Content-Type": "application/json", Authorization: authValue },
    body: options.body,
  });
}
