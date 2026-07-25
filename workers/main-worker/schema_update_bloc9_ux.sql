-- Bloc 9 : améliorations UX.

-- Ultimatum 2h avant expiration, en plus des relances 48h/24h existantes.
alter table users add column if not exists reminder_2h_sent boolean not null default false;

-- Statut "pas de signal aujourd'hui" sur le canal public — gate "une fois par jour",
-- même principe que leaderboard_posts (hebdomadaire) et lucky_vip_draws (quotidien).
create table if not exists no_signal_status_posts (
  id bigserial primary key,
  posted_at timestamptz not null default now()
);
create index if not exists idx_no_signal_status_posts_date on no_signal_status_posts (posted_at desc);

-- RELANCE50 remplace RELANCE20 pour la relance de réengagement post-expiration
-- (un seul code de rétention fort, réutilisé aussi par /cancel — voir Bloc 7).
update promo_codes set active = false where code = 'RELANCE20';
