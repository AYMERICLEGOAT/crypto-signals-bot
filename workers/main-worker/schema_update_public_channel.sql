-- À exécuter une fois dans le SQL Editor de Supabase (en plus des schémas
-- précédents) pour activer la diffusion différée vers le canal public gratuit.

alter table signals add column if not exists sent_to_channel boolean not null default false;

create index if not exists idx_signals_sent_to_channel on signals (sent_to_channel);
