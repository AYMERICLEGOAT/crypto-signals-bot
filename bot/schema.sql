-- Schéma Supabase pour le bot d'abonnement.
-- À exécuter dans le même projet Supabase que celui du module `signals/`
-- (SQL Editor -> New query -> coller -> Run).

create table if not exists users (
    telegram_id     bigint primary key,
    wallet_address  text,              -- adresse Polygon fournie par l'utilisateur (flux USDT)
    plan            smallint,          -- 1, 2, ou 0 pour un essai gratuit
    expiration      timestamptz,       -- reflète (ou dérive de) l'expiration on-chain / calculée
    trial_used      boolean not null default false,
    created_at      timestamptz not null default now()
);

create table if not exists pending_payments (
    id               bigserial primary key,
    telegram_id      bigint not null references users (telegram_id),
    method           text not null check (method in ('USDT', 'XMR', 'LTC')),
    plan             smallint not null,
    pay_address      text,             -- sous-adresse XMR ou adresse LTC dérivée (vide pour USDT)
    address_index    integer,          -- index de sous-adresse XMR / index HD LTC (vide pour USDT)
    amount_expected  numeric,          -- montant attendu dans la devise du paiement (vide pour USDT)
    status           text not null default 'pending' check (status in ('pending', 'confirmed', 'expired')),
    created_at       timestamptz not null default now(),
    confirmed_at     timestamptz
);

create index if not exists idx_pending_payments_status_method on pending_payments (status, method);
create index if not exists idx_pending_payments_telegram_id on pending_payments (telegram_id);

-- RLS : ce bot est un backend de confiance utilisant la clé service_role,
-- donc les policies ci-dessous sont volontairement permissives pour ce rôle.
-- Voir le README (section Supabase) si tu veux restreindre davantage.
