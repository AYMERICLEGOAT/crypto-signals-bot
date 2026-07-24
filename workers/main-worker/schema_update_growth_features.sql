-- Fonctionnalités de croissance/rétention (guide de paiement, contenu éducatif,
-- Lucky VIP Day, palier de parrainage, relances, réengagement, sondage).
-- Idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) : peut être relancé sans risque.

-- --- users : suivi des relances/réengagement/sondage/palier parrainage/VIP ---
alter table users add column if not exists plan_started_at timestamptz;
alter table users add column if not exists reminder_48h_sent boolean not null default false;
alter table users add column if not exists reminder_24h_sent boolean not null default false;
alter table users add column if not exists reengagement_sent boolean not null default false;
alter table users add column if not exists survey_sent boolean not null default false;
alter table users add column if not exists survey_response text check (survey_response in ('up', 'down'));
alter table users add column if not exists paid_referral_count integer not null default 0;
alter table users add column if not exists vip_until timestamptz;
alter table users add column if not exists pending_promo_code text;

-- --- contenu éducatif (item 3) ---
create table if not exists educational_posts (
    id            bigserial primary key,
    content       text not null,
    category      text,
    last_sent_at  timestamptz
);

create index if not exists idx_educational_posts_rotation on educational_posts (last_sent_at nulls first, id);

-- --- Lucky VIP Day (item 4) : historique des tirages ---
create table if not exists lucky_vip_draws (
    id            bigserial primary key,
    telegram_id   bigint not null references users (telegram_id),
    granted_at    timestamptz not null default now(),
    expires_at    timestamptz not null
);

create index if not exists idx_lucky_vip_draws_date on lucky_vip_draws (granted_at desc);

-- --- codes promo (item 7) ---
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
