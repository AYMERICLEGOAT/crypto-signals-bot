-- À exécuter une fois dans le SQL Editor de Supabase (même projet que les
-- autres modules) avant d'utiliser le module trafic/.
--
-- Garde une trace de ce qui a déjà été publié où, pour :
--   - ne jamais publier deux fois le même signal sur la même plateforme,
--   - respecter les délais minimum entre publications (Twitter, Reddit),
--   - alterner les subreddits ciblés.

create table if not exists posted_content (
    id          bigserial primary key,
    platform    text not null check (platform in ('twitter', 'reddit', 'discord')),
    signal_id   bigint not null references signals (id),
    target      text,              -- ex: nom du subreddit pour Reddit, vide sinon
    posted_at   timestamptz not null default now()
);

create index if not exists idx_posted_content_platform_date on posted_content (platform, posted_at desc);
