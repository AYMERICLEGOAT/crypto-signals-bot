-- Pause automatique de la génération de signaux (filtre anti-corrélation,
-- voir signals/correlation_guard.py) : si plus de 50% des paires suivies
-- déclenchent un signal dans la même direction en moins de 4h (risque de
-- marché systémique, pas un edge de la stratégie), bloque toute nouvelle
-- génération pendant 24h et poste un avertissement dans le canal public
-- (voir workers/main-worker, cron/announceSignalPause.ts).

create table if not exists signal_pause (
    id         bigserial primary key,
    paused_at  timestamptz not null default now(),
    resumes_at timestamptz not null,
    reason     text not null,
    announced  boolean not null default false
);

create index if not exists idx_signal_pause_active on signal_pause (resumes_at desc);
