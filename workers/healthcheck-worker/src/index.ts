/**
 * Worker de supervision : toutes les heures (Cron Trigger), vérifie que le
 * Worker principal répond et que Supabase est accessible. En cas d'anomalie,
 * envoie un message privé à l'administrateur via l'API Telegram.
 *
 * Exposé aussi en fetch() (GET /) pour pouvoir déclencher une vérification
 * manuelle immédiate pendant les tests, sans attendre la prochaine heure pile.
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_CHAT_ID: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  // Service binding (voir wrangler.toml [[services]]) : appel direct vers le
  // Worker principal, sans passer par le DNS public workers.dev — un fetch()
  // "normal" vers l'URL publique n'atteignait pas fiablement l'autre Worker.
  MAIN_WORKER: Fetcher;
  // Seuil en-dessous duquel on alerte pour réapprovisionner le pool d'adresses Litecoin.
  LITECOIN_POOL_ALERT_THRESHOLD?: string;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function checkMainWorker(env: Env): Promise<CheckResult> {
  try {
    const res = await env.MAIN_WORKER.fetch("https://main-worker.internal/health", {
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.text();
    return { name: "Worker principal", ok: res.ok, detail: `HTTP ${res.status} body="${body}"` };
  } catch (err) {
    return { name: "Worker principal", ok: false, detail: `injoignable: ${(err as Error).message}` };
  }
}

async function checkSupabase(env: Env): Promise<CheckResult> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/`, {
      headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}` },
      signal: AbortSignal.timeout(10_000),
    });
    return { name: "Supabase", ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { name: "Supabase", ok: false, detail: `injoignable: ${(err as Error).message}` };
  }
}

/** Alerte si le pool d'adresses Litecoin pré-générées devient bas (voir workers/main-worker/README.md). */
async function checkLitecoinPool(env: Env): Promise<CheckResult> {
  const threshold = Number(env.LITECOIN_POOL_ALERT_THRESHOLD || "5");
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/litecoin_address_pool?select=address&used=eq.false&limit=1`, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        Prefer: "count=exact",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { name: "Pool Litecoin", ok: false, detail: `HTTP ${res.status}` };

    const contentRange = res.headers.get("content-range") || "0/0";
    const total = Number(contentRange.split("/")[1] ?? "0");
    return {
      name: "Pool Litecoin",
      ok: total >= threshold,
      detail: `${total} adresse(s) disponible(s) (seuil: ${threshold})`,
    };
  } catch (err) {
    return { name: "Pool Litecoin", ok: false, detail: `vérification impossible: ${(err as Error).message}` };
  }
}

/**
 * CE QU'IL FAUT FAIRE, écrit dans l'alerte elle-même.
 *
 * « ❌ Supabase: HTTP 401 » a été envoyé le 12/08/2026, puis « ❌ Pool
 * Litecoin: HTTP 401 » le 13/08. Deux alertes exactes, et aucune des deux ne
 * disait la seule chose qui comptait : la clé Supabase de CE Worker-ci était
 * périmée, alors que celle du Worker principal fonctionnait toujours. Sans
 * cette phrase, l'alerte oblige à rouvrir le code pour comprendre de quoi elle
 * parle — et une alerte qu'on ne peut pas traiter en la lisant finit ignorée.
 */
function quoiFaire(c: CheckResult): string | null {
  if (/HTTP 401|HTTP 403/.test(c.detail)) {
    return "Clé Supabase de ce Worker refusée. Reposer la même que le Worker principal : `wrangler secret put SUPABASE_KEY` depuis workers/healthcheck-worker.";
  }
  if (c.name === "Pool Litecoin" && /adresse\(s\) disponible/.test(c.detail)) {
    return "Réapprovisionner le pool d'adresses Litecoin avant qu'un paiement ne trouve plus d'adresse libre.";
  }
  if (/db-unreachable/.test(c.detail)) {
    return "Le Worker principal ne joint plus Supabase. Vérifier l'état du projet Supabase ; si tout est vert, c'était un incident passager et cette alerte ne se répétera pas.";
  }
  return null;
}

async function alertAdmin(env: Env, failing: CheckResult[]): Promise<void> {
  const lignes = failing.map((c) => {
    const action = quoiFaire(c);
    return action ? `❌ ${c.name}: ${c.detail}\n   → ${action}` : `❌ ${c.name}: ${c.detail}`;
  });
  const text = "🚨 *Alerte supervision*\n\n" + lignes.join("\n\n");

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.ADMIN_CHAT_ID, text, parse_mode: "Markdown" }),
  });
}

async function runChecks(env: Env): Promise<CheckResult[]> {
  return Promise.all([checkMainWorker(env), checkSupabase(env), checkLitecoinPool(env)]);
}

/** Délai avant de reconfirmer un échec. Assez pour qu'un hoquet réseau soit passé, assez court pour tenir dans l'invocation. */
const DELAI_RECONFIRMATION_MS = 4_000;

/**
 * UN ÉCHEC N'EST PAS UNE PANNE TANT QU'IL N'A PAS ÉTÉ REVU.
 *
 * Le 12/08/2026 à 04:00 puis à 09:00, l'administrateur a reçu :
 *
 *   🚨 Alerte supervision
 *   ❌ Worker principal: HTTP 503 body="db-unreachable"
 *
 * Ce 503 vient de /health, qui fait UN appel à Supabase sans reprise : un
 * hoquet réseau d'une seconde suffisait à déclencher une alerte 🚨. Le système
 * fonctionnait avant et après, et le propriétaire n'avait rien à faire.
 *
 * Ce projet a déjà payé cette leçon en retirant l'alerte de bascule RPC : une
 * alerte non actionnable, répétée, apprend à ignorer TOUTES les alertes — et le
 * jour où un vrai problème de paiement arrive, il tombe dans un canal que plus
 * personne ne lit.
 *
 * On revérifie donc ce qui a échoué, une seule fois, quelques secondes plus
 * tard. Le coût est nul quand tout va bien (aucune revérification), et une
 * panne réelle est simplement signalée quatre secondes plus tard.
 */
async function echecsConfirmes(env: Env): Promise<CheckResult[]> {
  const premiers = (await runChecks(env)).filter((r) => !r.ok);
  if (premiers.length === 0) return [];

  await new Promise((resolve) => setTimeout(resolve, DELAI_RECONFIRMATION_MS));

  const seconds = await runChecks(env);
  // Seuls les contrôles qui échouent LES DEUX FOIS sont retenus. Le détail
  // rapporté est celui du second passage : c'est l'état le plus récent.
  return seconds.filter((r) => !r.ok && premiers.some((p) => p.name === r.name));
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const failing = await echecsConfirmes(env);
    if (failing.length > 0) {
      await alertAdmin(env, failing);
    }
    return new Response(JSON.stringify(failing.length > 0 ? failing : [{ ok: true }], null, 2), {
      status: failing.length > 0 ? 503 : 200,
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const failing = await echecsConfirmes(env);
        if (failing.length > 0) {
          await alertAdmin(env, failing);
        }
      })()
    );
  },
};
