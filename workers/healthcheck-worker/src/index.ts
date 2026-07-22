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

async function alertAdmin(env: Env, failing: CheckResult[]): Promise<void> {
  const text =
    "🚨 *Alerte supervision*\n\n" +
    failing.map((c) => `❌ ${c.name}: ${c.detail}`).join("\n");

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.ADMIN_CHAT_ID, text, parse_mode: "Markdown" }),
  });
}

async function runChecks(env: Env): Promise<CheckResult[]> {
  return Promise.all([checkMainWorker(env), checkSupabase(env), checkLitecoinPool(env)]);
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    const results = await runChecks(env);
    const failing = results.filter((r) => !r.ok);
    if (failing.length > 0) {
      await alertAdmin(env, failing);
    }
    return new Response(JSON.stringify(results, null, 2), {
      status: failing.length > 0 ? 503 : 200,
      headers: { "Content-Type": "application/json" },
    });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const results = await runChecks(env);
        const failing = results.filter((r) => !r.ok);
        if (failing.length > 0) {
          await alertAdmin(env, failing);
        }
      })()
    );
  },
};
