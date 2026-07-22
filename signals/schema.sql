-- Schéma Supabase (PostgreSQL) pour la table des signaux.
-- À exécuter une fois dans l'éditeur SQL de ton projet Supabase
-- (Dashboard -> SQL Editor -> New query -> coller -> Run).

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

-- Accélère les requêtes du bot Telegram qui cherchera les signaux non encore envoyés.
create index if not exists idx_signals_sent on signals (sent);
create index if not exists idx_signals_pair_created on signals (pair, created_at desc);
