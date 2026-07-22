-- À exécuter une fois dans le SQL Editor de Supabase (en plus de schema.sql)
-- pour activer les graphiques joints aux signaux.

alter table signals add column if not exists chart_url text;

-- Le bucket de stockage, lui, se crée à la main :
-- Dashboard Supabase -> Storage -> New bucket -> nom "signal-charts" -> Public bucket: activé.
