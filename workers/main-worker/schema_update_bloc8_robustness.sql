-- Bloc 8 : robustesse — surveillance de fraîcheur GitHub Actions.
-- payment_cache existe déjà (schema_update_bloc1to10.sql, section 11).

create table if not exists system_heartbeats (
  job_name     text primary key,
  last_run_at  timestamptz not null default now(),
  alerted      boolean not null default false
);
