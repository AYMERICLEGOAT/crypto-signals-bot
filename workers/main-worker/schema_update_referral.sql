-- À exécuter une fois dans le SQL Editor de Supabase (en plus des schémas
-- précédents) pour activer le parrainage.
--
-- Pas de colonne "referral_code" séparée : le code de parrainage est dérivé
-- directement du telegram_id (base36), donc décodable sans stockage
-- supplémentaire ni risque de collision.

alter table users add column if not exists referred_by bigint references users (telegram_id);
alter table users add column if not exists referral_rewarded boolean not null default false;

create index if not exists idx_users_referred_by on users (referred_by);
