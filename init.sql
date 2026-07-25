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
--   9. signals/schema_strategy_params.sql
--   10. workers/main-worker/schema_update_growth_features.sql
--   11. workers/main-worker/schema_update_bloc1to10.sql
--   12. signals/schema_signal_pause.sql
--   13. traffic/schema_nullable_signal_id.sql
--   14. workers/main-worker/schema_update_pricing.sql
--   15. signals/schema_momentum_alerts.sql
--   16. workers/main-worker/schema_update_referral_gamification.sql
--   17. workers/main-worker/schema_update_bloc7_rgpd.sql
--   18. workers/main-worker/schema_update_bloc8_robustness.sql
--   19. workers/main-worker/schema_update_bloc9_ux.sql
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
-- 9. signals/schema_strategy_params.sql — historique des paramètres de
--    stratégie retenus par backtest.py (remplace le fichier local
--    data/optimized_params.json, qui ne survit pas entre deux exécutions
--    GitHub Actions). Une seule ligne is_active = true à la fois.
--
--    Schéma tel que réellement déployé en production (voir params_store.py) :
--    pas de colonnes gain_loss_ratio / max_drawdown_pct / pairs_tested — ces
--    mesures restent uniquement dans les logs de backtest.py.
-- ----------------------------------------------------------------------------

create table if not exists strategy_params (
    id              bigserial primary key,
    param_set       text not null,
    ema_fast        integer not null,
    ema_slow        integer not null,
    rsi_period      integer not null,
    rsi_oversold    integer not null,
    rsi_overbought  integer not null,
    tp_pct          numeric not null,
    sl_pct          numeric not null,
    win_rate        numeric not null,
    trade_count     integer not null,
    last_tested     timestamptz not null default now(),
    is_active       boolean not null default false
);

create index if not exists idx_strategy_params_active on strategy_params (is_active) where is_active = true;


-- ----------------------------------------------------------------------------
-- 10. workers/main-worker/schema_update_growth_features.sql — guide de
--     paiement, contenu éducatif, Lucky VIP Day, palier de parrainage,
--     relances, réengagement, sondage de satisfaction
-- ----------------------------------------------------------------------------

alter table users add column if not exists plan_started_at timestamptz;
alter table users add column if not exists reminder_48h_sent boolean not null default false;
alter table users add column if not exists reminder_24h_sent boolean not null default false;
alter table users add column if not exists reengagement_sent boolean not null default false;
alter table users add column if not exists survey_sent boolean not null default false;
alter table users add column if not exists survey_response text check (survey_response in ('up', 'down'));
alter table users add column if not exists paid_referral_count integer not null default 0;
alter table users add column if not exists vip_until timestamptz;
alter table users add column if not exists pending_promo_code text;

create table if not exists educational_posts (
    id            bigserial primary key,
    content       text not null,
    category      text,
    last_sent_at  timestamptz
);

create index if not exists idx_educational_posts_rotation on educational_posts (last_sent_at nulls first, id);

create table if not exists lucky_vip_draws (
    id            bigserial primary key,
    telegram_id   bigint not null references users (telegram_id),
    granted_at    timestamptz not null default now(),
    expires_at    timestamptz not null
);

create index if not exists idx_lucky_vip_draws_date on lucky_vip_draws (granted_at desc);

create table if not exists promo_codes (
    code            text primary key,
    discount_pct    numeric not null,
    active          boolean not null default true,
    created_at      timestamptz not null default now()
);

create table if not exists promo_code_redemptions (
    id            bigserial primary key,
    code          text not null references promo_codes (code),
    telegram_id   bigint not null references users (telegram_id),
    redeemed_at   timestamptz not null default now(),
    unique (code, telegram_id)
);

insert into promo_codes (code, discount_pct)
values ('RELANCE20', 20)
on conflict (code) do nothing;


-- ----------------------------------------------------------------------------
-- Vérification optionnelle : liste les tables créées pour confirmer que tout
-- ----------------------------------------------------------------------------
-- 11. workers/main-worker/schema_update_bloc1to10.sql — Blocs 1 à 10
--     (archives backtest, offre de lancement, Effet Sniper, alertes momentum,
--     suivi post-trade, admin/rate-limit, stats quotidiennes, RGPD, cache
--     paiement, correction Lucky VIP Day)
-- ----------------------------------------------------------------------------

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

create table if not exists offer_counter (
    offer_name   text primary key,
    slots_total  integer not null,
    slots_used   integer not null default 0
);
insert into offer_counter (offer_name, slots_total, slots_used)
values ('decouverte', 50, 0)
on conflict (offer_name) do nothing;

create table if not exists signal_deliveries (
    id           bigserial primary key,
    signal_id    bigint not null references signals (id),
    telegram_id  bigint not null references users (telegram_id),
    tier         text not null check (tier in ('pro', 'standard')),
    delivered_at timestamptz not null default now()
);
create index if not exists idx_signal_deliveries_signal on signal_deliveries (signal_id);

-- Audit#2 : la définition de momentum_alerts prévue ici (alert_type/direction/
-- triggered_at) a été SUPERSEDÉE avant sa mise en usage réel par une forme
-- différente (kind/detail/created_at/sent_to_channel, voir section 15 —
-- signals/schema_momentum_alerts.sql, Bloc 3), qui est celle que le code
-- (signals/momentum.py, workers/main-worker/src/db/momentumAlerts.ts) utilise
-- réellement. Les deux définitions coexistaient ici et faisaient planter tout
-- déploiement neuf (la deuxième "create table if not exists" ne faisait rien,
-- puis son "create index" échouait sur des colonnes inexistantes). Supprimée
-- pour ne garder que la version réelle, plus bas.

alter table signals add column if not exists close_reason text check (close_reason in ('tp_hit', 'sl_hit', 'expired'));
alter table signals add column if not exists last_status_update_at timestamptz;

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

create table if not exists daily_stats (
    id                  bigserial primary key,
    stat_date           date not null unique,
    total_users         integer not null,
    active_trials       integer not null,
    paying_subscribers  integer not null,
    winrate_rolling_30d numeric,
    total_revenue_usdt  numeric not null default 0
);

alter table users add column if not exists cancelled boolean not null default false;
alter table users add column if not exists deleted boolean not null default false;

create table if not exists payment_cache (
    tx_hash         text primary key,
    verified_result boolean not null,
    checked_at      timestamptz not null default now()
);

alter table lucky_vip_draws add column if not exists previous_plan smallint;
alter table lucky_vip_draws add column if not exists reverted boolean not null default false;


-- ----------------------------------------------------------------------------
-- Vérification optionnelle : liste les tables créées pour confirmer que tout
-- s'est bien exécuté (à lancer séparément après le script ci-dessus si tu veux).
-- ----------------------------------------------------------------------------
-- select table_name from information_schema.tables
-- where table_schema = 'public'
-- order by table_name;


-- ----------------------------------------------------------------------------
-- 12. signals/schema_signal_pause.sql — pause automatique anti-corrélation
--     (si >50% des paires signalent la même direction en <4h, bloque 24h)
-- ----------------------------------------------------------------------------

create table if not exists signal_pause (
    id         bigserial primary key,
    paused_at  timestamptz not null default now(),
    resumes_at timestamptz not null,
    reason     text not null,
    announced  boolean not null default false
);

create index if not exists idx_signal_pause_active on signal_pause (resumes_at desc);


-- ----------------------------------------------------------------------------
-- 13. traffic/schema_nullable_signal_id.sql — résumés macro sans signal réel
-- ----------------------------------------------------------------------------

alter table posted_content alter column signal_id drop not null;


-- ----------------------------------------------------------------------------
-- 14. workers/main-worker/schema_update_pricing.sql — grille tarifaire
--     Découverte/Standard/Pro + Effet Sniper
-- ----------------------------------------------------------------------------

alter table users add column if not exists discovery_used boolean not null default false;
alter table signals add column if not exists sent_to_standard boolean not null default false;


-- ----------------------------------------------------------------------------
-- 15. signals/schema_momentum_alerts.sql — Alertes Momentum (Bloc 3)
-- ----------------------------------------------------------------------------

create table if not exists momentum_alerts (
  id bigint generated by default as identity primary key,
  pair text not null,
  kind text not null check (kind in ('rsi_neutral_exit', 'ema_cross_unconfirmed', 'atr_spike')),
  detail text not null,
  created_at timestamptz not null default now(),
  sent_to_channel boolean not null default false
);

create index if not exists idx_momentum_alerts_unsent on momentum_alerts (created_at asc) where sent_to_channel = false;


-- ----------------------------------------------------------------------------
-- 16. workers/main-worker/schema_update_referral_gamification.sql — Bloc 6
-- ----------------------------------------------------------------------------

create table if not exists referral_rewards (
  id bigint generated by default as identity primary key,
  referrer_telegram_id bigint not null references users (telegram_id),
  referred_telegram_id bigint not null references users (telegram_id),
  bonus_days integer not null,
  milestone_hit boolean not null default false,
  joker_hit boolean not null default false,
  rewarded_at timestamptz not null default now()
);
create index if not exists idx_referral_rewards_referrer_date on referral_rewards (referrer_telegram_id, rewarded_at desc);

create table if not exists leaderboard_posts (
  id bigserial primary key,
  posted_at timestamptz not null default now()
);
create index if not exists idx_leaderboard_posts_date on leaderboard_posts (posted_at desc);


-- ----------------------------------------------------------------------------
-- 17. workers/main-worker/schema_update_bloc7_rgpd.sql — Bloc 7
--     daily_stats, users.cancelled et users.deleted existent déjà (section 11)
-- ----------------------------------------------------------------------------

insert into promo_codes (code, discount_pct)
values ('RELANCE50', 50)
on conflict (code) do nothing;


-- ----------------------------------------------------------------------------
-- 18. workers/main-worker/schema_update_bloc8_robustness.sql — Bloc 8
--     payment_cache existe déjà (section 11)
-- ----------------------------------------------------------------------------

create table if not exists system_heartbeats (
  job_name     text primary key,
  last_run_at  timestamptz not null default now(),
  alerted      boolean not null default false
);


-- ----------------------------------------------------------------------------
-- 19. workers/main-worker/schema_update_bloc9_ux.sql — Bloc 9
-- ----------------------------------------------------------------------------

alter table users add column if not exists reminder_2h_sent boolean not null default false;

create table if not exists no_signal_status_posts (
  id bigserial primary key,
  posted_at timestamptz not null default now()
);
create index if not exists idx_no_signal_status_posts_date on no_signal_status_posts (posted_at desc);


-- ----------------------------------------------------------------------------
-- 20. Audit#14 — index manquants sur deux requêtes qui tournent toutes les
--     5 minutes (cron Worker) sans jamais avoir eu d'index dédié.
-- ----------------------------------------------------------------------------

-- getSignalsDueForStandardTier() (src/db/signals.ts) : WHERE sent_to_standard
-- = false ORDER BY created_at, en boucle toutes les 5 min. sent_to_standard
-- ne repasse jamais à false une fois à true (voir markSentToStandard) : un
-- index partiel reste donc petit indéfiniment, contrairement à un index
-- complet sur toute la table (même principe que idx_momentum_alerts_unsent
-- ci-dessus, section 15).
create index if not exists idx_signals_pending_standard on signals (created_at) where sent_to_standard = false;

-- Recherche d'utilisateur par adresse wallet (src/db/users.ts, getUserByWallet
-- et consorts) : utilisée par le rattachement des transferts USDT entrants
-- (cron/pollPayments.ts, toutes les 5 min) et l'anti-abus /trial. Egalité
-- simple sur une colonne jusqu'ici sans index -> scan complet de la table users.
create index if not exists idx_users_wallet_address on users (wallet_address);

update promo_codes set active = false where code = 'RELANCE20';
