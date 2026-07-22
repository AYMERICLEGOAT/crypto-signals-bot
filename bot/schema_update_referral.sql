-- Identique à workers/main-worker/schema_update_referral.sql (même table
-- `users`, partagée entre les deux versions du bot). Si tu as déjà exécuté
-- ce fichier côté Workers, inutile de le relancer ici — même projet Supabase.

alter table users add column if not exists referred_by bigint references users (telegram_id);
alter table users add column if not exists referral_rewarded boolean not null default false;

create index if not exists idx_users_referred_by on users (referred_by);
