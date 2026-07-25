-- Bloc 7 : code de rétention proposé par /cancel (-50%, voir bot/commands/cancel.ts).
-- daily_stats, users.cancelled et users.deleted existent déjà (schema_update_bloc1to10.sql).

insert into promo_codes (code, discount_pct)
values ('RELANCE50', 50)
on conflict (code) do nothing;
