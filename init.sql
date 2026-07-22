-- ============================================================================
-- init.sql — Schéma complet du projet, fusion de tous les fichiers .sql des
-- modules, dans l'ordre correct de leurs dépendances. À exécuter UNE FOIS
-- dans Supabase (Dashboard -> SQL Editor -> New query -> coller -> Run).
--
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / OR REPLACE) :
-- relancer ce script plus tard ne casse rien et ne duplique rien.
--
-- Origine de chaque section, si besoin de comparer avec les fichiers sources :
--   1. signals/schema.sql
--   2. signals/schema_update_chart.sql
--   3. website/schema_update.sql
--   4. bot/schema.sql
--   5. bot/schema_update_referral.sql (identique à workers/main-worker/schema_update_referral.sql)
--   6. traffic/schema_update.sql
--   7. workers/main-worker/schema.sql
--   8. workers/main-worker/schema_update_public_channel.sql
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. signals/schema.sql — table de base des signaux
-- ----------------------------------------------------------------------------

create table if not exists signals (
    id           bigserial primary key,
    pair         text not null,
    type         text not null check (type in ('BUY', 'SELL')),
    entry_price  numeric not null,
    stop_loss    numeric not null,
    take_profit  numeric not null,
    created_at   timestamptz not null default now(),
    sent         boolean not null default false
);

create index if not exists idx_signals_sent on signals (sent);
create index if not exists idx_signals_pair_created on signals (pair, created_at desc);


-- ----------------------------------------------------------------------------
-- 2. signals/schema_update_chart.sql — graphique joint à chaque signal
-- ----------------------------------------------------------------------------

alter table signals add column if not exists chart_url text;

-- Le bucket de stockage se crée à la main (pas en SQL) :
-- Dashboard Supabase -> Storage -> New bucket -> nom "signal-charts" -> Public bucket: activé.


-- ----------------------------------------------------------------------------
-- 3. website/schema_update.sql — suivi honnête des résultats passés
-- ----------------------------------------------------------------------------

alter table signals add column if not exists outcome text check (outcome in ('WIN', 'LOSS'));
alter table signals add column if not exists outcome_price numeric;
alter table signals add column if not exists evaluated_at timestamptz;

create index if not exists idx_signals_outcome on signals (outcome);


-- ----------------------------------------------------------------------------
-- 4. bot/schema.sql — utilisateurs et paiements en attente
-- ----------------------------------------------------------------------------

create table if not exists users (
    telegram_id     bigint primary key,
    wallet_address  text,
    plan            smallint,
    expiration      timestamptz,
    trial_used      boolean not null default false,
    created_at      timestamptz not null default now()
);

create table if not exists pending_payments (
    id               bigserial primary key,
    telegram_id      bigint not null references users (telegram_id),
    method           text not null check (method in ('USDT', 'XMR', 'LTC')),
    plan             smallint not null,
    pay_address      text,
    address_index    integer,
    amount_expected  numeric,
    status           text not null default 'pending' check (status in ('pending', 'confirmed', 'expired')),
    created_at       timestamptz not null default now(),
    confirmed_at     timestamptz
);

create index if not exists idx_pending_payments_status_method on pending_payments (status, method);
create index if not exists idx_pending_payments_telegram_id on pending_payments (telegram_id);


-- ----------------------------------------------------------------------------
-- 5. bot/schema_update_referral.sql — parrainage (code dérivé du telegram_id,
--    pas de colonne séparée, donc pas de risque de collision)
-- ----------------------------------------------------------------------------

alter table users add column if not exists referred_by bigint references users (telegram_id);
alter table users add column if not exists referral_rewarded boolean not null default false;

create index if not exists idx_users_referred_by on users (referred_by);


-- ----------------------------------------------------------------------------
-- 6. traffic/schema_update.sql — historique de publication (réseaux sociaux)
-- ----------------------------------------------------------------------------

create table if not exists posted_content (
    id          bigserial primary key,
    platform    text not null check (platform in ('twitter', 'reddit', 'discord')),
    signal_id   bigint not null references signals (id),
    target      text,
    posted_at   timestamptz not null default now()
);

create index if not exists idx_posted_content_platform_date on posted_content (platform, posted_at desc);


-- ----------------------------------------------------------------------------
-- 7. workers/main-worker/schema.sql — état du Worker (pas de fichiers locaux
--    possibles sur Cloudflare Workers) + pool d'adresses Litecoin
-- ----------------------------------------------------------------------------

create table if not exists pending_actions (
    telegram_id  bigint primary key,
    action_type  text not null check (action_type in ('awaiting_wallet_usdt', 'awaiting_wallet_trial')),
    plan         smallint,
    updated_at   timestamptz not null default now()
);

create table if not exists chain_state (
    key   text primary key,
    value text not null
);

create table if not exists litecoin_address_pool (
    address                  text primary key,
    hd_index                 integer not null unique,
    used                     boolean not null default false,
    reserved_for_telegram_id bigint,
    reserved_at              timestamptz
);

create index if not exists idx_litecoin_pool_unused on litecoin_address_pool (hd_index) where used = false;

-- Réservation atomique d'une adresse Litecoin non utilisée (évite qu'une
-- course entre deux requêtes concurrentes ne réserve deux fois la même adresse).
create or replace function claim_litecoin_address(p_telegram_id bigint)
returns setof litecoin_address_pool
language plpgsql
as $$
begin
    return query
    update litecoin_address_pool
    set used = true,
        reserved_for_telegram_id = p_telegram_id,
        reserved_at = now()
    where address = (
        select address from litecoin_address_pool
        where used = false
        order by hd_index asc
        limit 1
        for update skip locked
    )
    returning *;
end;
$$;


-- ----------------------------------------------------------------------------
-- 8. workers/main-worker/schema_update_public_channel.sql — diffusion différée
--    (15 min) des signaux déjà envoyés aux abonnés vers le canal public gratuit
-- ----------------------------------------------------------------------------

alter table signals add column if not exists sent_to_channel boolean not null default false;

create index if not exists idx_signals_sent_to_channel on signals (sent_to_channel);


-- ----------------------------------------------------------------------------
-- Vérification optionnelle : liste les tables créées pour confirmer que tout
-- s'est bien exécuté (à lancer séparément après le script ci-dessus si tu veux).
-- ----------------------------------------------------------------------------
-- select table_name from information_schema.tables
-- where table_schema = 'public'
-- order by table_name;
