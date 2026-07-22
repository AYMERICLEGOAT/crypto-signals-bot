-- À exécuter une fois dans le SQL Editor de Supabase (même projet que les
-- modules signals/ et bot/) avant d'utiliser le générateur SEO.
--
-- Ajoute le suivi des résultats réels des signaux passés, nécessaire pour
-- afficher une section "Performance" honnête sur le site (calculée à partir
-- de vrais résultats, pas de chiffres inventés).

alter table signals add column if not exists outcome text check (outcome in ('WIN', 'LOSS'));
alter table signals add column if not exists outcome_price numeric;
alter table signals add column if not exists evaluated_at timestamptz;

create index if not exists idx_signals_outcome on signals (outcome);
