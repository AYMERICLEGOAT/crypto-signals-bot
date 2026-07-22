/**
 * Client REST minimal pour Supabase (PostgREST), sans le SDK @supabase/supabase-js.
 * Utilise uniquement `fetch`, donc garanti compatible avec le runtime Workers.
 *
 * Syntaxe des filtres : convention PostgREST, ex. { telegram_id: "eq.123" }.
 * https://postgrest.org/en/stable/references/api/tables_views.html#operators
 */

export interface SupabaseConfig {
  url: string;
  key: string;
}

function headers(config: SupabaseConfig, extra?: Record<string, string>): HeadersInit {
  return {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function query(filters?: Record<string, string>): string {
  if (!filters || Object.keys(filters).length === 0) return "";
  return `?${new URLSearchParams(filters).toString()}`;
}

async function assertOk(res: Response, action: string, table: string): Promise<void> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${action} ${table} a répondu ${res.status}: ${body}`);
  }
}

export async function selectRows<T>(
  config: SupabaseConfig,
  table: string,
  filters?: Record<string, string>
): Promise<T[]> {
  const res = await fetch(`${config.url}/rest/v1/${table}${query(filters)}`, { headers: headers(config) });
  await assertOk(res, "select", table);
  return (await res.json()) as T[];
}

export async function selectOne<T>(
  config: SupabaseConfig,
  table: string,
  filters: Record<string, string>
): Promise<T | null> {
  const rows = await selectRows<T>(config, table, filters);
  return rows[0] ?? null;
}

export async function insertRow<T>(config: SupabaseConfig, table: string, row: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.url}/rest/v1/${table}`, {
    method: "POST",
    headers: headers(config, { Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  await assertOk(res, "insert", table);
  const rows = (await res.json()) as T[];
  return rows[0];
}

export async function updateRows<T>(
  config: SupabaseConfig,
  table: string,
  filters: Record<string, string>,
  patch: Record<string, unknown>
): Promise<T[]> {
  const res = await fetch(`${config.url}/rest/v1/${table}${query(filters)}`, {
    method: "PATCH",
    headers: headers(config, { Prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  await assertOk(res, "update", table);
  return (await res.json()) as T[];
}

export async function deleteRows(config: SupabaseConfig, table: string, filters: Record<string, string>): Promise<void> {
  const res = await fetch(`${config.url}/rest/v1/${table}${query(filters)}`, {
    method: "DELETE",
    headers: headers(config),
  });
  await assertOk(res, "delete", table);
}

/** POST avec `Prefer: resolution=merge-duplicates` : insère ou met à jour selon la contrainte `onConflict`. */
export async function upsertRow<T>(
  config: SupabaseConfig,
  table: string,
  row: Record<string, unknown>,
  onConflict: string
): Promise<T> {
  const res = await fetch(`${config.url}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: headers(config, { Prefer: "return=representation,resolution=merge-duplicates" }),
    body: JSON.stringify(row),
  });
  await assertOk(res, "upsert", table);
  const rows = (await res.json()) as T[];
  return rows[0];
}

/** Appelle une fonction SQL exposée par PostgREST (POST /rest/v1/rpc/<nom>). */
export async function callRpc<T>(config: SupabaseConfig, functionName: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${config.url}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: headers(config),
    body: JSON.stringify(args),
  });
  await assertOk(res, "rpc", functionName);
  return (await res.json()) as T;
}

/** Ping minimal pour le healthcheck : vérifie que l'API REST répond. */
export async function pingSupabase(config: SupabaseConfig): Promise<boolean> {
  const res = await fetch(`${config.url}/rest/v1/`, { headers: headers(config) });
  return res.ok;
}
