-- Tables supplémentaires nécessaires à la version Cloudflare Workers du bot.
-- Les tables `users`, `pending_payments` et `signals` existent déjà (voir
-- bot/schema.sql et signals/schema.sql du module 2 / module 1) — exécute
-- CE fichier en plus, dans le même projet Supabase.

-- Remplace la Map en mémoire du bot Node (module 2) : un Worker est sans état
-- entre deux requêtes, donc "quelle info texte libre on attend de cet
-- utilisateur" doit être persisté ici plutôt qu'en mémoire.
create table if not exists pending_actions (
    telegram_id  bigint primary key,
    action_type  text not null check (action_type in ('awaiting_wallet_usdt', 'awaiting_wallet_trial')),
    plan         smallint,
    updated_at   timestamptz not null default now()
);

-- Remplace data/last_block.json (module 2) : petite table clé/valeur pour
-- retenir le dernier bloc Polygon traité lors du rattrapage des événements
-- `Subscribed` (le Worker n'a pas de système de fichiers persistant).
create table if not exists chain_state (
    key   text primary key,
    value text not null
);

-- Pool d'adresses Litecoin pré-générées hors-ligne (voir
-- scripts/generate-litecoin-pool.ts). Le Worker ne fait QUE réserver une
-- adresse jamais utilisée — il ne dérive jamais de clé lui-même.
create table if not exists litecoin_address_pool (
    address                  text primary key,
    hd_index                 integer not null unique,
    used                     boolean not null default false,
    reserved_for_telegram_id bigint,
    reserved_at              timestamptz
);

create index if not exists idx_litecoin_pool_unused on litecoin_address_pool (hd_index) where used = false;

-- Réservation atomique d'une adresse Litecoin non utilisée : évite qu'une
-- course entre deux requêtes concurrentes ne réserve deux fois la même
-- adresse (ce qu'un simple SELECT puis UPDATE depuis le Worker ne garantirait pas).
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
