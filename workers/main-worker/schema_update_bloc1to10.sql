-- Migration consolidée pour les Blocs 1 à 10 (améliorations majeures).
-- Idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING) : peut être relancée sans risque.

-- ===== Bloc 1.1 : archives de trades du backtest (exemples réels, dates réelles) =====
create table if not exists backtest_trades (
    id            bigserial primary key,
    pair          text not null,
    side          text not null check (side in ('BUY', 'SELL')),
    entry_price   numeric not null,
    exit_price    numeric not null,
    outcome       text not null check (outcome in ('WIN', 'LOSS', 'TIMEOUT')),
    pnl_pct       numeric not null,
    entered_at    timestamptz not null,
    exited_at     timestamptz not null,
    created_at    timestamptz not null default now()
);

-- ===== Bloc 2.2 : compteur réel de l'offre de lancement =====
create table if not exists offer_counter (
    offer_name   text primary key,
    slots_total  integer not null,
    slots_used   integer not null default 0
);
insert into offer_counter (offer_name, slots_total, slots_used)
values ('decouverte', 50, 0)
on conflict (offer_name) do nothing;

-- ===== Bloc 2.3 : Effet Sniper — trace qui a reçu quoi et quand =====
create table if not exists signal_deliveries (
    id           bigserial primary key,
    signal_id    bigint not null references signals (id),
    telegram_id  bigint not null references users (telegram_id),
    tier         text not null check (tier in ('pro', 'standard')),
    delivered_at timestamptz not null default now()
);
create index if not exists idx_signal_deliveries_signal on signal_deliveries (signal_id);

-- ===== Bloc 3 : alertes momentum (anti-doublon) =====
create table if not exists momentum_alerts (
    id           bigserial primary key,
    pair         text not null,
    alert_type   text not null check (alert_type in ('rsi_exit_neutral', 'ema_cross', 'atr_spike')),
    direction    text,
    triggered_at timestamptz not null default now()
);
create index if not exists idx_momentum_alerts_pair_type_date on momentum_alerts (pair, alert_type, triggered_at desc);

-- ===== Bloc 4 : suivi post-trade (outcome/outcome_price/evaluated_at existent déjà) =====
alter table signals add column if not exists close_reason text check (close_reason in ('tp_hit', 'sl_hit', 'expired'));
alter table signals add column if not exists last_status_update_at timestamptz;

-- ===== Bloc 5.2/5.3 : log admin + rate limiting =====
create table if not exists admin_actions (
    id                  bigserial primary key,
    admin_telegram_id   bigint not null,
    action              text not null,
    target_telegram_id  bigint,
    details             text,
    created_at          timestamptz not null default now()
);

create table if not exists command_rate_limit (
    telegram_id  bigint primary key,
    window_start timestamptz not null,
    count        integer not null default 0
);

-- ===== Bloc 7.2 : stats quotidiennes =====
create table if not exists daily_stats (
    id                  bigserial primary key,
    stat_date           date not null unique,
    total_users         integer not null,
    active_trials       integer not null,
    paying_subscribers  integer not null,
    winrate_rolling_30d numeric,
    total_revenue_usdt  numeric not null default 0
);

-- ===== Bloc 7.3/7.4 : suppression de données + annulation =====
alter table users add column if not exists cancelled boolean not null default false;
alter table users add column if not exists deleted boolean not null default false;

-- ===== Bloc 8.4 : cache de vérification de paiement =====
create table if not exists payment_cache (
    tx_hash         text primary key,
    verified_result boolean not null,
    checked_at      timestamptz not null default now()
);

-- ===== Bloc 10.4 : pouvoir annuler le Lucky VIP Day proprement =====
alter table lucky_vip_draws add column if not exists previous_plan smallint;
alter table lucky_vip_draws add column if not exists reverted boolean not null default false;
