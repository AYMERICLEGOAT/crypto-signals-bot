-- ============================================================================
-- init.sql — Schéma complet du projet, fusion de tous les fichiers .sql des
-- modules, dans l'ordre correct de leurs dépendances. À exécuter UNE FOIS
-- dans Supabase (Dashboard -> SQL Editor -> New query -> coller -> Run).
--
-- Toutes les instructions sont idempotentes (IF NOT EXISTS / OR REPLACE) :
-- relancer ce script plus tard ne casse rien et ne duplique rien.
--
-- Origine de chaque section, si besoin de comparer avec les fichiers sources :
--   1. signals/schema.sql
--   2. signals/schema_update_chart.sql
--   3. website/schema_update.sql
--   4. bot/schema.sql
--   5. bot/schema_update_referral.sql (identique à workers/main-worker/schema_update_referral.sql)
--   6. traffic/schema_update.sql
--   7. workers/main-worker/schema.sql
--   8. workers/main-worker/schema_update_public_channel.sql
--   9. signals/schema_strategy_params.sql
--   10. workers/main-worker/schema_update_growth_features.sql
--   11. workers/main-worker/schema_update_bloc1to10.sql
--   12. signals/schema_signal_pause.sql
--   13. traffic/schema_nullable_signal_id.sql
--   14. workers/main-worker/schema_update_pricing.sql
--   15. signals/schema_momentum_alerts.sql
--   16. workers/main-worker/schema_update_referral_gamification.sql
--   17. workers/main-worker/schema_update_bloc7_rgpd.sql
--   18. workers/main-worker/schema_update_bloc8_robustness.sql
--   19. workers/main-worker/schema_update_bloc9_ux.sql
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. signals/schema.sql — table de base des signaux
-- ----------------------------------------------------------------------------

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

create index if not exists idx_signals_sent on signals (sent);
create index if not exists idx_signals_pair_created on signals (pair, created_at desc);


-- ----------------------------------------------------------------------------
-- 2. signals/schema_update_chart.sql — graphique joint à chaque signal
-- ----------------------------------------------------------------------------

alter table signals add column if not exists chart_url text;

-- Le bucket de stockage se crée à la main (pas en SQL) :
-- Dashboard Supabase -> Storage -> New bucket -> nom "signal-charts" -> Public bucket: activé.


-- ----------------------------------------------------------------------------
-- 3. website/schema_update.sql — suivi honnête des résultats passés
-- ----------------------------------------------------------------------------

alter table signals add column if not exists outcome text check (outcome in ('WIN', 'LOSS'));
alter table signals add column if not exists outcome_price numeric;
alter table signals add column if not exists evaluated_at timestamptz;

create index if not exists idx_signals_outcome on signals (outcome);


-- ----------------------------------------------------------------------------
-- 4. bot/schema.sql — utilisateurs et paiements en attente
-- ----------------------------------------------------------------------------

create table if not exists users (
    telegram_id     bigint primary key,
    wallet_address  text,
    plan            smallint,
    expiration      timestamptz,
    trial_used      boolean not null default false,
    created_at      timestamptz not null default now()
);

create table if not exists pending_payments (
    id               bigserial primary key,
    telegram_id      bigint not null references users (telegram_id),
    method           text not null check (method in ('USDT', 'XMR', 'LTC')),
    plan             smallint not null,
    pay_address      text,
    address_index    integer,
    amount_expected  numeric,
    status           text not null default 'pending' check (status in ('pending', 'confirmed', 'expired')),
    created_at       timestamptz not null default now(),
    confirmed_at     timestamptz
);

create index if not exists idx_pending_payments_status_method on pending_payments (status, method);
create index if not exists idx_pending_payments_telegram_id on pending_payments (telegram_id);


-- ----------------------------------------------------------------------------
-- 5. bot/schema_update_referral.sql — parrainage (code dérivé du telegram_id,
--    pas de colonne séparée, donc pas de risque de collision)
-- ----------------------------------------------------------------------------

alter table users add column if not exists referred_by bigint references users (telegram_id);
alter table users add column if not exists referral_rewarded boolean not null default false;

create index if not exists idx_users_referred_by on users (referred_by);


-- ----------------------------------------------------------------------------
-- 6. traffic/schema_update.sql — historique de publication (réseaux sociaux)
-- ----------------------------------------------------------------------------

create table if not exists posted_content (
    id          bigserial primary key,
    platform    text not null check (platform in ('twitter', 'reddit', 'discord')),
    signal_id   bigint not null references signals (id),
    target      text,
    posted_at   timestamptz not null default now()
);

create index if not exists idx_posted_content_platform_date on posted_content (platform, posted_at desc);


-- ----------------------------------------------------------------------------
-- 7. workers/main-worker/schema.sql — état du Worker (pas de fichiers locaux
--    possibles sur Cloudflare Workers) + pool d'adresses Litecoin
-- ----------------------------------------------------------------------------

create table if not exists pending_actions (
    telegram_id  bigint primary key,
    action_type  text not null check (action_type in ('awaiting_wallet_usdt', 'awaiting_wallet_trial')),
    plan         smallint,
    updated_at   timestamptz not null default now()
);

create table if not exists chain_state (
    key   text primary key,
    value text not null
);

create table if not exists litecoin_address_pool (
    address                  text primary key,
    hd_index                 integer not null unique,
    used                     boolean not null default false,
    reserved_for_telegram_id bigint,
    reserved_at              timestamptz
);

create index if not exists idx_litecoin_pool_unused on litecoin_address_pool (hd_index) where used = false;

-- Réservation atomique d'une adresse Litecoin non utilisée (évite qu'une
-- course entre deux requêtes concurrentes ne réserve deux fois la même adresse).
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


-- ----------------------------------------------------------------------------
-- 8. workers/main-worker/schema_update_public_channel.sql — diffusion différée
--    (15 min) des signaux déjà envoyés aux abonnés vers le canal public gratuit
-- ----------------------------------------------------------------------------

alter table signals add column if not exists sent_to_channel boolean not null default false;

create index if not exists idx_signals_sent_to_channel on signals (sent_to_channel);


-- ----------------------------------------------------------------------------
-- 9. signals/schema_strategy_params.sql — historique des paramètres de
--    stratégie retenus par backtest.py (remplace le fichier local
--    data/optimized_params.json, qui ne survit pas entre deux exécutions
--    GitHub Actions). Une seule ligne is_active = true à la fois.
--
--    Schéma tel que réellement déployé en production (voir params_store.py) :
--    pas de colonnes gain_loss_ratio / max_drawdown_pct / pairs_tested — ces
--    mesures restent uniquement dans les logs de backtest.py.
-- ----------------------------------------------------------------------------

create table if not exists strategy_params (
    id              bigserial primary key,
    param_set       text not null,
    ema_fast        integer not null,
    ema_slow        integer not null,
    rsi_period      integer not null,
    rsi_oversold    integer not null,
    rsi_overbought  integer not null,
    tp_pct          numeric not null,
    sl_pct          numeric not null,
    win_rate        numeric not null,
    trade_count     integer not null,
    last_tested     timestamptz not null default now(),
    is_active       boolean not null default false
);

create index if not exists idx_strategy_params_active on strategy_params (is_active) where is_active = true;


-- ----------------------------------------------------------------------------
-- 10. workers/main-worker/schema_update_growth_features.sql — guide de
--     paiement, contenu éducatif, Lucky VIP Day, palier de parrainage,
--     relances, réengagement, sondage de satisfaction
-- ----------------------------------------------------------------------------

alter table users add column if not exists plan_started_at timestamptz;
alter table users add column if not exists reminder_48h_sent boolean not null default false;
alter table users add column if not exists reminder_24h_sent boolean not null default false;
alter table users add column if not exists reengagement_sent boolean not null default false;
alter table users add column if not exists survey_sent boolean not null default false;
alter table users add column if not exists survey_response text check (survey_response in ('up', 'down'));
alter table users add column if not exists paid_referral_count integer not null default 0;
alter table users add column if not exists vip_until timestamptz;
alter table users add column if not exists pending_promo_code text;

create table if not exists educational_posts (
    id            bigserial primary key,
    content       text not null,
    category      text,
    last_sent_at  timestamptz
);

create index if not exists idx_educational_posts_rotation on educational_posts (last_sent_at nulls first, id);

-- Index unique (pas une contrainte "add constraint if not exists", non
-- portable) : permet on conflict (content) do nothing ci-dessous, pour que
-- ré-exécuter ce fichier ne duplique jamais les 30 lignes -- même bug que
-- celui vécu sur crypto_facts (une ré-exécution avait recréé une ligne en
-- double, faute d'un tel garde-fou à l'origine).
create unique index if not exists idx_educational_posts_content_unique on educational_posts (content);

-- Contenu du 01/08/2026 (refonte UX) : les 30 posts n'avaient jusqu'ici
-- jamais été committés (seedés directement en base) -- ajoutés ici pour
-- qu'un environnement reconstruit à partir de ce fichier les retrouve tels
-- quels. Voir workers/main-worker/src/cron/dispatchEducationalPost.ts
-- (envoyé en texte brut, sans markdown -- pas d'échappement nécessaire ici).
insert into educational_posts (content) values
('📈 L''EMA : l''arme préférée des traders qui détestent être en retard. En donnant plus de poids aux prix récents, elle réagit plus vite qu''une moyenne mobile simple aux changements de tendance — au prix de plus de faux signaux.'),
('🔀 Le croisement EMA9/EMA21 : quand la courte passe au-dessus de la longue, beaucoup de traders y voient un signal haussier. Un indice, jamais une certitude — à combiner avec d''autres indicateurs.'),
('🌡️ Le RSI, c''est le thermomètre du marché : de 0 à 100, il mesure la vitesse et l''ampleur des variations de prix. En dessous de 30 : "survendu". Au-dessus de 70 : "suracheté".'),
('⚠️ Piège classique du RSI : un actif "survendu" peut le rester longtemps en pleine tendance baissière. Le RSI mesure le momentum, il ne prédit pas un rebond.'),
('📏 Les bandes de Bollinger entourent une moyenne mobile grâce à l''écart-type du prix. Plus elles s''écartent, plus la volatilité grimpe à cet instant précis.'),
('⚡ Le "squeeze" : quand les bandes de Bollinger se resserrent fort, un mouvement de prix plus marqué suit souvent — dans un sens... ou dans l''autre.'),
('🛑 Le stop loss clôture automatiquement une position perdante à un niveau fixé à l''avance. Le définir AVANT d''entrer évite de décider à chaud, sous le coup de l''émotion.'),
('🎯 Stop loss trop serré = déclenché par le simple bruit du marché. Trop large = ne protège plus rien. Le bon réglage dépend de la volatilité de l''actif, jamais d''un chiffre universel.'),
('💰 Le take profit sécurise un gain automatiquement, à un niveau fixé à l''avance — sans avoir à fixer les graphiques en continu.'),
('⚖️ Le ratio risque/rendement compare ta perte potentielle (jusqu''au stop) à ton gain potentiel (jusqu''au take profit). Un ratio 1:2 veut dire : viser deux fois plus de gain que de risque pris.'),
('🧮 Règle d''or : ne jamais risquer plus de 1-2% de son capital sur une seule position. De quoi encaisser plusieurs pertes d''affilée sans être éliminé.'),
('📐 La taille de position ne se choisit pas au hasard : elle se calcule à partir du capital total, du % de risque accepté, et de la distance jusqu''au stop loss — jamais un montant fixe identique à chaque trade.'),
('⏱️ Un croisement de moyennes mobiles confirme une tendance — ce n''est pas un signal de timing parfait. Le temps que le croisement se confirme, le prix a souvent déjà bougé.'),
('🧩 Combiner plusieurs indicateurs (croisement EMA + confirmation RSI, par exemple) réduit les faux signaux — mais n''élimine jamais complètement le risque d''erreur.'),
('🔍 Le choix du timeframe change tout : un signal en bougies horaires n''a pas la même fiabilité qu''un signal en bougies 5 minutes. Plus le timeframe est court, plus le bruit domine.'),
('🧭 Un même actif peut sembler haussier en journalier et baissier en horaire, au même instant. Rester fidèle à UN timeframe de référence évite la confusion.'),
('🌊 La volatilité mesure l''AMPLEUR des mouvements de prix, pas leur direction. Un marché très volatil peut aussi bien monter que s''effondrer.'),
('🎢 Les cryptos sont bien plus volatiles que les actions ou le forex : un mouvement de 5-10% en une journée n''a rien d''exceptionnel — contrairement à d''autres marchés.'),
('🧱 Un support, c''est un niveau où la demande a historiquement freiné une baisse. Une résistance, l''inverse. Des zones probabilistes — jamais des lignes magiques infranchissables.'),
('🔄 Une résistance cassée devient souvent... un nouveau support (et inversement). La psychologie collective des acteurs du marché change à ce niveau précis.'),
('🔬 Un backtest simule une stratégie sur des données passées pour estimer sa performance. Utile pour valider une logique — mais un bon backtest ne garantit jamais un résultat identique en conditions réelles.'),
('🚩 L''overfitting : coller une stratégie aux données passées jusqu''à ce qu''elle perde toute capacité à réagir aux nouvelles. Une stratégie "parfaite" en backtest est un signal d''alerte, pas de confiance.'),
('🪙 Le DCA (dollar-cost averaging) : investir un montant fixe à intervalles réguliers plutôt qu''une grosse somme d''un coup. Ça lisse le prix d''achat moyen et réduit l''impact du timing.'),
('📊 Les marchés crypto alternent accumulation (prix stable), tendance (mouvement clair) et distribution (retournement). Reconnaître la phase actuelle aide à interpréter les signaux.'),
('😱 Le FOMO pousse à entrer en position après une forte hausse — souvent trop tard. Des règles claires, écrites à l''avance, aident à résister à cette impulsion.'),
('🔥 Après une perte, l''envie de "se refaire" avec une position plus grosse est l''une des erreurs les plus coûteuses en trading. Le revenge trading amplifie les pertes, il ne les répare jamais.'),
('📓 Tenir un journal de trading (pourquoi tu entres, pourquoi tu sors, ce qui a marché ou non) révèle tes propres biais bien mieux que ta mémoire seule.'),
('🚫 Erreur classique : déplacer son stop loss plus loin quand le prix s''en approche "pour laisser une chance au trade". Ça transforme une perte maîtrisée en perte potentiellement illimitée.'),
('🔁 Erreur classique #2 : changer de stratégie après chaque perte isolée. Une stratégie s''évalue sur des dizaines de trades, jamais sur un seul résultat.'),
('🔮 Aucun indicateur, aussi bien construit soit-il, ne prédit l''avenir avec certitude — il décrit une probabilité basée sur des schémas passés. La gestion du risque compte autant que la qualité du signal.')
on conflict (content) do nothing;

create table if not exists lucky_vip_draws (
    id            bigserial primary key,
    telegram_id   bigint not null references users (telegram_id),
    granted_at    timestamptz not null default now(),
    expires_at    timestamptz not null
);

create index if not exists idx_lucky_vip_draws_date on lucky_vip_draws (granted_at desc);

create table if not exists promo_codes (
    code            text primary key,
    discount_pct    numeric not null,
    active          boolean not null default true,
    created_at      timestamptz not null default now()
);

create table if not exists promo_code_redemptions (
    id            bigserial primary key,
    code          text not null references promo_codes (code),
    telegram_id   bigint not null references users (telegram_id),
    redeemed_at   timestamptz not null default now(),
    unique (code, telegram_id)
);

insert into promo_codes (code, discount_pct)
values ('RELANCE20', 20)
on conflict (code) do nothing;


-- ----------------------------------------------------------------------------
-- Vérification optionnelle : liste les tables créées pour confirmer que tout
-- ----------------------------------------------------------------------------
-- 11. workers/main-worker/schema_update_bloc1to10.sql — Blocs 1 à 10
--     (archives backtest, offre de lancement, Effet Sniper, alertes momentum,
--     suivi post-trade, admin/rate-limit, stats quotidiennes, RGPD, cache
--     paiement, correction Lucky VIP Day)
-- ----------------------------------------------------------------------------

create table if not exists backtest_trades (
    id            bigserial primary key,
    pair          text not null,
    side          text not null check (side in ('BUY', 'SELL')),
    entry_price   numeric not null,
    exit_price    numeric not null,
    outcome       text not null check (outcome in ('WIN', 'LOSS', 'TIMEOUT')),
    pnl_pct       numeric not null,
    entered_at    timestamptz not null,
    exited_at     timestamptz not null,
    created_at    timestamptz not null default now()
);

create table if not exists offer_counter (
    offer_name   text primary key,
    slots_total  integer not null,
    slots_used   integer not null default 0
);
insert into offer_counter (offer_name, slots_total, slots_used)
values ('decouverte', 50, 0)
on conflict (offer_name) do nothing;

-- Bloc 14.3 : mois offert aux 10 premiers abonnés Standard (voir cron/pollPayments.ts, onPaymentConfirmed).
insert into offer_counter (offer_name, slots_total, slots_used)
values ('early_adopter', 10, 0)
on conflict (offer_name) do nothing;

create table if not exists signal_deliveries (
    id           bigserial primary key,
    signal_id    bigint not null references signals (id),
    telegram_id  bigint not null references users (telegram_id),
    tier         text not null check (tier in ('pro', 'standard')),
    delivered_at timestamptz not null default now()
);
create index if not exists idx_signal_deliveries_signal on signal_deliveries (signal_id);

-- Audit#2 : la définition de momentum_alerts prévue ici (alert_type/direction/
-- triggered_at) a été SUPERSEDÉE avant sa mise en usage réel par une forme
-- différente (kind/detail/created_at/sent_to_channel, voir section 15 —
-- signals/schema_momentum_alerts.sql, Bloc 3), qui est celle que le code
-- (signals/momentum.py, workers/main-worker/src/db/momentumAlerts.ts) utilise
-- réellement. Les deux définitions coexistaient ici et faisaient planter tout
-- déploiement neuf (la deuxième "create table if not exists" ne faisait rien,
-- puis son "create index" échouait sur des colonnes inexistantes). Supprimée
-- pour ne garder que la version réelle, plus bas.

alter table signals add column if not exists close_reason text check (close_reason in ('tp_hit', 'sl_hit', 'expired'));
alter table signals add column if not exists last_status_update_at timestamptz;

create table if not exists admin_actions (
    id                  bigserial primary key,
    admin_telegram_id   bigint not null,
    action              text not null,
    target_telegram_id  bigint,
    details             text,
    created_at          timestamptz not null default now()
);

create table if not exists command_rate_limit (
    telegram_id  bigint primary key,
    window_start timestamptz not null,
    count        integer not null default 0
);

create table if not exists daily_stats (
    id                  bigserial primary key,
    stat_date           date not null unique,
    total_users         integer not null,
    active_trials       integer not null,
    paying_subscribers  integer not null,
    winrate_rolling_30d numeric,
    total_revenue_usdt  numeric not null default 0
);

alter table users add column if not exists cancelled boolean not null default false;
alter table users add column if not exists deleted boolean not null default false;

create table if not exists payment_cache (
    tx_hash         text primary key,
    verified_result boolean not null,
    checked_at      timestamptz not null default now()
);

alter table lucky_vip_draws add column if not exists previous_plan smallint;
alter table lucky_vip_draws add column if not exists reverted boolean not null default false;


-- ----------------------------------------------------------------------------
-- Vérification optionnelle : liste les tables créées pour confirmer que tout
-- s'est bien exécuté (à lancer séparément après le script ci-dessus si tu veux).
-- ----------------------------------------------------------------------------
-- select table_name from information_schema.tables
-- where table_schema = 'public'
-- order by table_name;


-- ----------------------------------------------------------------------------
-- 12. signals/schema_signal_pause.sql — pause automatique anti-corrélation
--     (si >50% des paires signalent la même direction en <4h, bloque 24h)
-- ----------------------------------------------------------------------------

create table if not exists signal_pause (
    id         bigserial primary key,
    paused_at  timestamptz not null default now(),
    resumes_at timestamptz not null,
    reason     text not null,
    announced  boolean not null default false
);

create index if not exists idx_signal_pause_active on signal_pause (resumes_at desc);


-- ----------------------------------------------------------------------------
-- 13. traffic/schema_nullable_signal_id.sql — résumés macro sans signal réel
-- ----------------------------------------------------------------------------

alter table posted_content alter column signal_id drop not null;


-- ----------------------------------------------------------------------------
-- 14. workers/main-worker/schema_update_pricing.sql — grille tarifaire
--     Découverte/Standard/Pro + Effet Sniper
-- ----------------------------------------------------------------------------

alter table users add column if not exists discovery_used boolean not null default false;
alter table signals add column if not exists sent_to_standard boolean not null default false;


-- ----------------------------------------------------------------------------
-- 15. signals/schema_momentum_alerts.sql — Alertes Momentum (Bloc 3)
-- ----------------------------------------------------------------------------

create table if not exists momentum_alerts (
  id bigint generated by default as identity primary key,
  pair text not null,
  kind text not null check (kind in ('rsi_neutral_exit', 'ema_cross_unconfirmed', 'atr_spike')),
  detail text not null,
  created_at timestamptz not null default now(),
  sent_to_channel boolean not null default false
);

create index if not exists idx_momentum_alerts_unsent on momentum_alerts (created_at asc) where sent_to_channel = false;


-- ----------------------------------------------------------------------------
-- 16. workers/main-worker/schema_update_referral_gamification.sql — Bloc 6
-- ----------------------------------------------------------------------------

create table if not exists referral_rewards (
  id bigint generated by default as identity primary key,
  referrer_telegram_id bigint not null references users (telegram_id),
  referred_telegram_id bigint not null references users (telegram_id),
  bonus_days integer not null,
  milestone_hit boolean not null default false,
  joker_hit boolean not null default false,
  rewarded_at timestamptz not null default now()
);
create index if not exists idx_referral_rewards_referrer_date on referral_rewards (referrer_telegram_id, rewarded_at desc);

create table if not exists leaderboard_posts (
  id bigserial primary key,
  posted_at timestamptz not null default now()
);
create index if not exists idx_leaderboard_posts_date on leaderboard_posts (posted_at desc);


-- ----------------------------------------------------------------------------
-- 17. workers/main-worker/schema_update_bloc7_rgpd.sql — Bloc 7
--     daily_stats, users.cancelled et users.deleted existent déjà (section 11)
-- ----------------------------------------------------------------------------

insert into promo_codes (code, discount_pct)
values ('RELANCE50', 50)
on conflict (code) do nothing;


-- ----------------------------------------------------------------------------
-- 18. workers/main-worker/schema_update_bloc8_robustness.sql — Bloc 8
--     payment_cache existe déjà (section 11)
-- ----------------------------------------------------------------------------

create table if not exists system_heartbeats (
  job_name     text primary key,
  last_run_at  timestamptz not null default now(),
  alerted      boolean not null default false
);


-- ----------------------------------------------------------------------------
-- 19. workers/main-worker/schema_update_bloc9_ux.sql — Bloc 9
-- ----------------------------------------------------------------------------

alter table users add column if not exists reminder_2h_sent boolean not null default false;

create table if not exists no_signal_status_posts (
  id bigserial primary key,
  posted_at timestamptz not null default now()
);
create index if not exists idx_no_signal_status_posts_date on no_signal_status_posts (posted_at desc);


-- ----------------------------------------------------------------------------
-- 20. Audit#14 — index manquants sur deux requêtes qui tournent toutes les
--     5 minutes (cron Worker) sans jamais avoir eu d'index dédié.
-- ----------------------------------------------------------------------------

-- getSignalsDueForStandardTier() (src/db/signals.ts) : WHERE sent_to_standard
-- = false ORDER BY created_at, en boucle toutes les 5 min. sent_to_standard
-- ne repasse jamais à false une fois à true (voir markSentToStandard) : un
-- index partiel reste donc petit indéfiniment, contrairement à un index
-- complet sur toute la table (même principe que idx_momentum_alerts_unsent
-- ci-dessus, section 15).
create index if not exists idx_signals_pending_standard on signals (created_at) where sent_to_standard = false;

-- Recherche d'utilisateur par adresse wallet (src/db/users.ts, getUserByWallet
-- et consorts) : utilisée par le rattachement des transferts USDT entrants
-- (cron/pollPayments.ts, toutes les 5 min) et l'anti-abus /trial. Egalité
-- simple sur une colonne jusqu'ici sans index -> scan complet de la table users.
create index if not exists idx_users_wallet_address on users (wallet_address);

update promo_codes set active = false where code = 'RELANCE20';


-- ----------------------------------------------------------------------------
-- 21. Audit#21 — séquence de bienvenue en plusieurs messages (voir
--     cron/welcomeSequence.ts). Un seul message à /start ne rappelait jamais
--     /demo, /trial ou /referral à quelqu'un qui n'avait rien fait ensuite.
-- ----------------------------------------------------------------------------

alter table users add column if not exists welcome_1h_sent boolean not null default false;
alter table users add column if not exists welcome_1d_sent boolean not null default false;


-- ----------------------------------------------------------------------------
-- 22. Amélioration 9 — score de confiance (0-100) affiché avec chaque signal
--     (voir signals/confidence.py). Purement informatif, ne prédit pas le
--     résultat du trade (vérifié empiriquement, voir docstring du module).
-- ----------------------------------------------------------------------------

alter table signals add column if not exists confidence_score smallint;


-- ----------------------------------------------------------------------------
-- 23. Bloc 11.3 — suspension automatique en cas de volatilité extrême (voir
--     signals/main.py, ATR intraday > VOLATILITY_SUSPENSION_ATR_PCT du prix).
--     Même pattern que momentum_alerts (section 15) : Python écrit l'événement,
--     le Worker le relaie sur le canal public puis le marque envoyé.
-- ----------------------------------------------------------------------------

create table if not exists volatility_suspensions (
    id             bigserial primary key,
    pair           text not null,
    atr_pct        numeric not null,
    created_at     timestamptz not null default now(),
    sent_to_channel boolean not null default false
);

create index if not exists idx_volatility_suspensions_unsent on volatility_suspensions (created_at) where sent_to_channel = false;


-- ----------------------------------------------------------------------------
-- 24. Bloc 12.2 — "Le saviez-vous ?" : anecdotes crypto en rotation sans
--     répétition, même mécanisme que educational_posts (section 19).
-- ----------------------------------------------------------------------------

create table if not exists crypto_facts (
    id            bigserial primary key,
    content       text not null unique,
    last_sent_at  timestamptz
);

create index if not exists idx_crypto_facts_rotation on crypto_facts (last_sent_at nulls first, id);

-- Contenu réécrit le 01/08/2026 (refonte UX) : même fait, formulation plus
-- percutante -- voir workers/main-worker/src/cron/dispatchCryptoFact.ts
-- (envoyé en markdown, d'où l'échappement de l'underscore sur OP\_RETURN,
-- même bug que celui vécu le 29/07 sur /help et /referral).
insert into crypto_facts (content) values
('🍕 2 pizzas = 10 000 BTC. Le 22 mai 2010, quelqu''un a fait l''échange le plus commenté de l''histoire crypto — aujourd''hui célébré chaque année comme le "Bitcoin Pizza Day".'),
('🗞️ Le tout premier bloc de Bitcoin (3 janvier 2009) cache un message : le titre d''un article du Times sur un plan de sauvetage bancaire. Un clin d''œil qui n''a rien d''un hasard.'),
('🕵️ Le plus grand mystère de la crypto : personne ne sait qui est "Satoshi Nakamoto", le ou les créateurs de Bitcoin. Leur identité n''a jamais été révélée.'),
('🔒 21 millions. Pas un de plus. Le nombre maximum de bitcoins qui existeront un jour est gravé dans le protocole depuis le premier jour.'),
('🔬 Le plus petit fragment de Bitcoin s''appelle un "satoshi" — un cent-millionième de BTC. De quoi acheter du Bitcoin même avec un tout petit budget.'),
('⚙️ Ethereum a changé la donne en introduisant les "smart contracts" : des programmes qui s''exécutent automatiquement sur la blockchain, sans intermédiaire.'),
('⏳ Depuis 2009, la blockchain Bitcoin tourne en continu, sans interruption majeure — un des réseaux informatiques les plus fiables jamais créés.'),
('✍️ "HODL" est né d''une faute de frappe sur un forum en 2013 ("I AM HODLING"). Depuis, c''est devenu un mot culte de toute la culture crypto.'),
('✂️ Chaque bloc miné rapportait 50 BTC avant 2020. Ce montant est divisé par deux tous les ~4 ans, lors du "halving" — un mécanisme intégré dès le départ.'),
('📅 Le tout dernier bitcoin ne sera miné que vers l''an 2140 — au rythme du halving, la récompense continue de fondre tous les 4 ans.'),
('🇸🇻 En 2021, le Salvador est devenu le premier pays au monde à adopter le bitcoin comme monnaie légale, aux côtés du dollar.'),
('⛓️ "Blockchain" veut dire exactement ce que ça dit : une chaîne de blocs de données, liés entre eux par cryptographie.'),
('🔑 Perdre la clé privée de son portefeuille crypto, c''est perdre l''accès à ses fonds — pour toujours. Il n''y a pas de bouton "mot de passe oublié".'),
('💀 On estime que plusieurs millions de bitcoins sont perdus à jamais, coincés derrière des clés privées égarées.'),
('⛏️ La preuve de travail (proof of work) de Bitcoin consomme de l''énergie... volontairement. C''est ce coût qui sécurise le réseau contre la fraude.'),
('🔀 En 2022, Ethereum a changé de moteur en plein vol : passage de la preuve de travail à la preuve d''enjeu (proof of stake), lors de "The Merge".'),
('🔐 Le "crypto" de cryptomonnaie vient de cryptographie — la technique qui sécurise les transactions. Rien à voir avec un quelconque secret.'),
('📄 Le Bitcoin Whitepaper, publié par Satoshi Nakamoto en octobre 2008, tient sur 9 pages. Neuf pages qui ont changé la finance mondiale.'),
('🧮 Une adresse Bitcoin peut recevoir des fonds sans jamais avoir servi : elle est générée mathématiquement, personne n''a besoin de te l''"attribuer".'),
('🖼️ Les NFT (jetons non fongibles) permettent de représenter la propriété d''un objet numérique unique — impossible à dupliquer sur la blockchain.'),
('🐕 Dogecoin est né en 2013 comme une blague basée sur un mème de chien Shiba Inu. Plus de dix ans après, c''est toujours l''une des cryptos les plus connues au monde.'),
('⏮️ Une transaction Bitcoin confirmée ne peut JAMAIS être annulée. Pas de service client, pas de retour en arrière possible.'),
('💵 Les "stablecoins" comme l''USDT visent une valeur stable, généralement indexée sur le dollar — un pont entre crypto et monnaie traditionnelle.'),
('🚀 Fondée en 2017, Binance est devenue en quelques années l''une des plus grandes plateformes d''échange crypto au monde.'),
('⛽ Le "gas" sur Ethereum, ce sont les frais à payer pour exécuter une transaction ou un smart contract — le prix du calcul sur la blockchain.'),
('👛 Un "wallet" crypto ne stocke pas vraiment tes pièces : il garde les clés qui prouvent que tu les possèdes sur la blockchain.'),
('📈 En 2021, la capitalisation totale du marché crypto a dépassé les 1 000 milliards de dollars pour la toute première fois.'),
('🧩 Miner un bloc Bitcoin, c''est résoudre un calcul cryptographique complexe — mais vérifié ensuite en un instant par n''importe quel autre nœud du réseau.'),
('⚡ Lancée en 2020, Solana mise tout sur la vitesse : des temps de confirmation de transaction largement plus rapides que Bitcoin.'),
('🧠 Vitalik Buterin avait 19 ans quand il a proposé Ethereum, en 2013. Aujourd''hui, c''est l''une des blockchains les plus utilisées au monde.'),
('🪙 "Altcoin" désigne simplement toute cryptomonnaie qui n''est pas le Bitcoin — des milliers de projets rentrent dans cette case.'),
('⏱️ La blockchain Bitcoin ajoute un nouveau bloc environ toutes les 10 minutes, en moyenne, depuis 2009.'),
('🌍 Certains gouvernements ont interdit les cryptomonnaies. D''autres les ont pleinement intégrées à leur économie. La régulation reste un vrai patchwork mondial.'),
('❄️ Un "cold wallet" garde tes clés hors ligne, totalement coupées d''internet — la meilleure protection contre le piratage à distance.'),
('🎁 Un "airdrop", c''est une distribution gratuite de jetons à des utilisateurs — souvent utilisé pour faire connaître un nouveau projet.'),
('🍴 Une "fork" crée une nouvelle version d''une blockchain. Bitcoin Cash est ainsi né d''une bifurcation de Bitcoin, en 2017.'),
('🥈 Litecoin, lancé en 2011, se présente souvent comme "l''argent" à côté de "l''or" que représenterait le Bitcoin.'),
('🌙 Le trading crypto ne s''arrête jamais : 24h/24, 7j/7, week-ends compris — contrairement aux marchés boursiers traditionnels.'),
('📝 Une seed phrase de 12 ou 24 mots suffit à restaurer un portefeuille crypto entier, sur n''importe quel appareil, n''importe où.'),
('🤝 Aucun mineur ne peut valider un bloc Bitcoin invalide tout seul : chaque bloc doit passer par le consensus de l''ensemble du réseau.'),
('🏦 La "DeFi" (finance décentralisée) veut recréer prêts, échanges et services financiers... sans passer par une banque.'),
('🌐 XRP, la cryptomonnaie liée à Ripple, cible en priorité un objectif précis : accélérer les transferts internationaux entre institutions financières.'),
('🎢 Une variation de plus de 10% en une seule journée ? Banal en crypto. Bien plus violent que la plupart des actifs traditionnels.'),
('🏧 Le tout premier distributeur automatique de Bitcoin a été installé au Canada, en 2013.'),
('🕶️ Chaque transaction Bitcoin est publique et consultable par tous — mais les identités réelles derrière les adresses restent cachées. Pseudonymat, pas anonymat total.'),
('🐋 Une "baleine" désigne un détenteur avec une quantité de crypto si importante qu''il peut, à lui seul, influencer le marché.'),
('🚫 En 2021, la Chine a interdit le minage de cryptomonnaies sur son territoire, provoquant l''exode massif des mineurs vers d''autres pays.'),
('🗂️ Le champ "OP\_RETURN" permet d''inscrire une petite quantité de données arbitraires directement dans une transaction Bitcoin.'),
('🧪 Un "testnet" est un réseau blockchain parallèle, pensé pour tester du code sans jamais risquer le moindre vrai fonds.'),
('🔐 Une adresse "multisig" exige plusieurs signatures différentes avant de valider une transaction — parfait pour sécuriser des fonds partagés à plusieurs.'),
('❓ Le symbole ₿ pour le Bitcoin n''a rien d''officiel : aucune norme Unicode universelle ne l''a jamais consacré.')
on conflict (content) do nothing;


-- ----------------------------------------------------------------------------
-- 25. Bloc 12.1 — Fear & Greed Index quotidien (voir cron/dispatchFearGreed.ts,
--     API publique alternative.me). Table journal (pas de "state" générique
--     dans le projet) : sert aussi de gate "déjà publié aujourd'hui".
-- ----------------------------------------------------------------------------

create table if not exists fear_greed_posts (
    id            bigserial primary key,
    value         smallint not null,
    classification text not null,
    posted_at     timestamptz not null default now()
);

create index if not exists idx_fear_greed_posts_posted_at on fear_greed_posts (posted_at desc);


-- ----------------------------------------------------------------------------
-- 26. Bloc 12.3 — récap hebdomadaire (dimanche 18h UTC, voir
--     cron/dispatchWeeklyRecap.ts). Table journal, même rôle que
--     fear_greed_posts : gate "déjà publié cette semaine".
-- ----------------------------------------------------------------------------

create table if not exists weekly_recap_posts (
    id          bigserial primary key,
    posted_at   timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 27. Bloc 14.2 — enquête de départ à /cancel (voir
--     bot/commands/exitSurveyResponse.ts). Consultable via /stats admin.
-- ----------------------------------------------------------------------------

create table if not exists exit_surveys (
    id           bigserial primary key,
    telegram_id  bigint not null references users (telegram_id),
    reason       text not null check (reason in ('frequency', 'performance', 'price', 'other')),
    created_at   timestamptz not null default now()
);


-- ----------------------------------------------------------------------------
-- 28. Bloc 19 — /prefs : préférences de notification par abonné. Les Alertes
--     Momentum / posts éducatifs / récap hebdo sont diffusés sur le canal
--     public (voir cron/dispatchMomentumAlerts.ts etc.) ; ces préférences
--     contrôlent en plus un envoi optionnel en DM aux abonnés actifs, activé
--     par défaut. Les signaux Haute confiance ne sont PAS ici : ils restent
--     obligatoires pour un abonné payant (pas de colonne = pas de choix).
-- ----------------------------------------------------------------------------

create table if not exists user_prefs (
    telegram_id       bigint primary key references users (telegram_id),
    momentum_alerts   boolean not null default true,
    educational_posts boolean not null default true,
    weekly_recap      boolean not null default true
);


-- ----------------------------------------------------------------------------
-- 29. ÉTAPE 5 — mécanisme anti-stress : compte les pertes consécutives par
--     abonné payant (voir cron/trackSignalOutcomes.ts) pour envoyer un
--     message de réassurance après 2 pertes d'affilée, et une célébration
--     légère après un take profit. Remis à zéro à chaque gain.
-- ----------------------------------------------------------------------------

alter table users add column if not exists consecutive_losses smallint not null default 0;


-- ----------------------------------------------------------------------------
-- 30. BLOC 22 — commissions virtuelles de parrainage : 10% du montant payé
--     par le filleul, créditées au parrain à titre INFORMATIF uniquement
--     (voir bot/referral.ts, maybeRewardReferral) -- jamais versées
--     automatiquement, aucun flux d'argent réel associé à cette colonne.
-- ----------------------------------------------------------------------------

alter table referral_rewards add column if not exists commission_usd numeric not null default 0;


-- ----------------------------------------------------------------------------
-- 31. UX signaux — trailing stop optionnel (voir cron/trackSignalOutcomes.ts,
--     signalMath.ts::computeTrailingStop) : opt-in (défaut false, contrairement
--     aux préférences de notification de la section 28 qui sont opt-out), donc
--     colonne séparée plutôt qu'ajoutée à la logique existante de /prefs.
--     trailing_stop_price est purement indicatif — ne modifie JAMAIS le
--     stop_loss/take_profit officiels ni le calcul du win rate affiché
--     publiquement (transparence, /myperformance, backtest) : deux abonnés
--     avec des préférences différentes doivent voir le même résultat officiel
--     pour un même signal.
-- ----------------------------------------------------------------------------

alter table user_prefs add column if not exists trailing_stop boolean not null default false;
alter table signals add column if not exists trailing_stop_price numeric;


-- ----------------------------------------------------------------------------
-- 32. Mission "grille d'excellence" — gestion Multi-TP avec sécurisation
--     Break-Even (voir signals/strategy.py::_build_signal,
--     signals/config.py::ENABLE_MULTI_TP_EXITS, cron/trackSignalOutcomes.ts).
--     take_profit reste égal à tp2_price (objectif principal) pour que tout
--     code existant qui ne connaît que take_profit continue de fonctionner
--     sans modification. breakeven_active passe à true dès que TP1 est
--     touché : à partir de là, le stop_loss OFFICIEL n'est plus le SL
--     d'origine mais le prix d'entrée (voir trackSignalOutcomes.ts, jamais
--     recalculé côté client pour éviter toute divergence d'affichage).
-- ----------------------------------------------------------------------------

alter table signals add column if not exists tp1_price numeric;
alter table signals add column if not exists tp2_price numeric;
alter table signals add column if not exists tp3_price numeric;
alter table signals add column if not exists tp1_hit_at timestamptz;
alter table signals add column if not exists tp2_hit_at timestamptz;
alter table signals add column if not exists tp3_hit_at timestamptz;
alter table signals add column if not exists breakeven_active boolean not null default false;

alter table strategy_params add column if not exists multi_tp_enabled boolean not null default false;
alter table strategy_params add column if not exists sl_atr_mult numeric;
alter table strategy_params add column if not exists tp1_atr_mult numeric;
alter table strategy_params add column if not exists tp2_atr_mult numeric;
alter table strategy_params add column if not exists tp3_atr_mult numeric;
alter table strategy_params add column if not exists tp1_weight numeric;
alter table strategy_params add column if not exists tp2_weight numeric;
alter table strategy_params add column if not exists tp3_weight numeric;

-- ----------------------------------------------------------------------------
-- 33. Étape 3 (preuve sociale) — /review : note rapide (pouce haut/bas) +
--     commentaire optionnel envoyé en réponse libre juste après (voir
--     pendingActions.ts). Anonymisé côté site (jamais le telegram_id publié).
-- ----------------------------------------------------------------------------

create table if not exists reviews (
  id bigint generated always as identity primary key,
  telegram_id bigint not null,
  rating text not null check (rating in ('up', 'down')),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_reviews_created_at on reviews (created_at desc);

alter table pending_actions add column if not exists review_id bigint;

-- ----------------------------------------------------------------------------
-- 34. Verrou de portefeuille (MAX_ACTIVE_TRADES, voir signals/config.py et
--     signals/main.py::run_once) -- trace la config active, purement
--     informatif/historique comme les colonnes multi_tp_* ci-dessus.
-- ----------------------------------------------------------------------------

alter table strategy_params add column if not exists portfolio_lock_enabled boolean not null default false;
alter table strategy_params add column if not exists max_active_trades integer;
alter table strategy_params add column if not exists pairs_count integer;


-- ----------------------------------------------------------------------------
-- 35. Correctif momentum_alerts — la table live en base était restée sur
--     l'ANCIEN schéma (alert_type/direction/triggered_at) que l'audit#2 avait
--     pourtant retiré d'init.sql au profit de kind/detail/created_at/
--     sent_to_channel (section 15) : ce "create table if not exists" étant un
--     no-op sur une table qui existe déjà, la vraie table Supabase n'a jamais
--     été migrée. Résultat : chaque tentative d'insertion (signals/storage.py,
--     Bloc 3) échouait silencieusement depuis le début (PGRST204 "Could not
--     find the 'detail' column"), et aucune alerte momentum n'a donc jamais
--     été envoyée. Table vide en production (0 ligne) -> migration sans
--     perte de données.
-- ----------------------------------------------------------------------------

drop table if exists momentum_alerts;

create table momentum_alerts (
  id bigint generated by default as identity primary key,
  pair text not null,
  kind text not null check (kind in ('rsi_neutral_exit', 'ema_cross_unconfirmed', 'atr_spike')),
  detail text not null,
  created_at timestamptz not null default now(),
  sent_to_channel boolean not null default false
);

create index if not exists idx_momentum_alerts_unsent on momentum_alerts (created_at asc) where sent_to_channel = false;


-- ----------------------------------------------------------------------------
-- 36. admin_notes — canal d'échange asynchrone entre l'admin et la routine
--     quotidienne autonome (OPS_ROUTINE_PROMPT.md) : la routine tourne une
--     fois par jour de façon non interactive (tâche planifiée locale), donc
--     ne peut pas tenir une conversation en direct. À la place : la routine
--     pose une question via Telegram et l'enregistre ici (sender='routine'),
--     l'admin répond n'importe quand via /opsnote <texte> dans le bot (stocké
--     ici avec sender='admin'), et le run suivant lit les entrées
--     sender='admin' non lues (read_at is null), agit en conséquence, et les
--     marque lues.
-- ----------------------------------------------------------------------------

create table if not exists admin_notes (
  id bigint generated by default as identity primary key,
  sender text not null check (sender in ('admin', 'routine')),
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists idx_admin_notes_unread on admin_notes (created_at asc) where read_at is null;


-- ----------------------------------------------------------------------------
-- 37. Expiration des codes promo — jusqu'ici `promo_codes` n'avait qu'un
--     drapeau `active` à désactiver manuellement, aucune notion de date de
--     fin : une offre annoncée comme "limitée dans le temps" (ex: RELANCE50,
--     -50%) pouvait tourner indéfiniment si personne n'y pensait. NULL =
--     toujours pas de date de fin (comportement identique à avant pour les
--     codes existants, changement non cassant) ; une valeur ici la fait
--     expirer automatiquement sans intervention manuelle.
-- ----------------------------------------------------------------------------

alter table promo_codes add column if not exists expires_at timestamptz;

-- ----------------------------------------------------------------------------
-- 43. Limiteur de commandes atomique : une lecture suivie d'un upsert côté
-- Worker laissait passer deux requêtes Telegram concurrentes. Toute la
-- décision est maintenant prise dans une seule transaction PostgreSQL.
-- (Numérotée 43 : collision évitée avec la section 39 "source hybride" déjà
-- existante plus bas dans ce fichier au moment où celle-ci a été écrite.)
-- ----------------------------------------------------------------------------

create or replace function consume_command_rate_limit(
  p_telegram_id bigint,
  p_window_ms integer,
  p_max_commands integer
)
returns table(allowed boolean)
language plpgsql
as $$
declare
  now_utc timestamptz := now();
  current_count integer;
  current_start timestamptz;
begin
  select count, window_start into current_count, current_start
  from command_rate_limit where telegram_id = p_telegram_id for update;

  if not found or current_start <= now_utc - make_interval(secs => p_window_ms / 1000.0) then
    insert into command_rate_limit (telegram_id, window_start, count)
    values (p_telegram_id, now_utc, 1)
    on conflict (telegram_id) do update set window_start = excluded.window_start, count = excluded.count;
    return query select true;
  end if;

  if current_count >= p_max_commands then
    return query select false;
  end if;

  update command_rate_limit set count = count + 1 where telegram_id = p_telegram_id;
  return query select true;
end;
$$;


-- ----------------------------------------------------------------------------
-- 38. increment_offer_slot — corrige une race sur offer_counter.slots_used
--     (Pack Découverte / bonus early-adopter) : db/offerCounter.ts faisait un
--     SELECT puis un UPDATE slots_used = <valeur lue> + 1 en deux requêtes
--     séparées. Si deux invocations du cron Worker se chevauchent (ex: un
--     appel Monero-RPC/Blockchair qui traîne au-delà du cycle de 5 min), les
--     deux peuvent lire la même valeur avant que l'une des deux n'écrive,
--     perdant un incrément (2 places consommées comptées comme 1 seule) et
--     pouvant même appliquer deux fois le bonus "10 premiers abonnés" à un
--     même utilisateur. Un seul UPDATE atomique (même principe que
--     claim_litecoin_address, plus haut) élimine la fenêtre de course.
-- ----------------------------------------------------------------------------

create or replace function increment_offer_slot(p_offer_name text)
returns setof offer_counter
language plpgsql
as $$
begin
    return query
    update offer_counter
    set slots_used = slots_used + 1
    where offer_name = p_offer_name
      and slots_used < slots_total
    returning *;
end;
$$;


-- ----------------------------------------------------------------------------
-- 39. Refonte "source hybride" (signals/main.py::fetch_recent_prices) —
--     Binance (geo-bloqué depuis GitHub Actions) -> CoinGecko -> Coinbase
--     Exchange -> Kraken. Ces deux colonnes suivent les cycles horaires
--     consécutifs où les 4 sources ont échoué pour TOUTES les paires (état
--     que le heartbeat seul ne détecte pas : il se rafraîchit même à 0
--     signal/0 donnée, voir signals/storage.py::record_source_health).
--     source_outage_alerted suit le même principe que la colonne `alerted`
--     existante (une seule alerte par panne, pas une par cycle).
-- ----------------------------------------------------------------------------

alter table system_heartbeats
  add column if not exists consecutive_source_failures integer not null default 0,
  add column if not exists source_outage_alerted boolean not null default false;


-- ----------------------------------------------------------------------------
-- 40. Second moteur de signaux "⚡ Squeeze Volatilité 15M" (voir
--     signals/squeeze_engine.py) — tourne en parallèle du moteur historique
--     "🎯 Haute Confiance" pour augmenter la fréquence de signaux. Chaque
--     ligne existante est réputée venir du moteur historique (defaut
--     'high_confidence'), signals/strategy.py l'écrit désormais explicitement.
-- ----------------------------------------------------------------------------

alter table signals add column if not exists engine text not null default 'high_confidence';
create index if not exists idx_signals_engine on signals (engine);


-- ----------------------------------------------------------------------------
-- 41. Audit#30 (30/07) — alerte "aucun signal depuis 6h" (voir
--     workers/main-worker/src/cron/checkSignalFreshness.ts), indépendante
--     de `alerted` (qui suit "le job ne tourne plus", pas "le job tourne
--     mais ne trouve rien").
-- ----------------------------------------------------------------------------

alter table system_heartbeats add column if not exists no_signal_alerted boolean not null default false;


-- ----------------------------------------------------------------------------
-- 42. Correctif spam Alertes Momentum (30/07, retour admin "120 messages
--     d'un coup") — le plafond quotidien (workers/main-worker/src/cron/
--     dispatchMomentumAlerts.ts) comptait par `created_at` (date de
--     détection), pas par date d'envoi réel : un stock d'anciennes alertes
--     jamais diffusées (accumulé pendant les ralentissements du cron) se
--     drainait donc SANS jamais compter contre le quota du jour, un cycle
--     de 5 min après l'autre, jusqu'à épuisement complet du stock. `sent_at`
--     permet de compter par date d'ENVOI réelle.
-- ----------------------------------------------------------------------------

alter table momentum_alerts add column if not exists sent_at timestamptz;


-- ----------------------------------------------------------------------------
-- 44. Dette de schéma strategy_params (audit du 31/07) -- aucun bug actif
-- (signals/params_store.py fournit toujours une valeur pour ces colonnes,
-- workers/main-worker ne fait que les lire), mais le type de `id` et les
-- contraintes NOT NULL en base ne correspondaient plus à ce que ce fichier
-- documente depuis longtemps. Alignement, pas correctif urgent.
-- ----------------------------------------------------------------------------

alter table strategy_params alter column id type bigint;
alter table strategy_params alter column ema_fast set not null;
alter table strategy_params alter column ema_slow set not null;
alter table strategy_params alter column rsi_period set not null;
alter table strategy_params alter column rsi_oversold set not null;
alter table strategy_params alter column rsi_overbought set not null;
alter table strategy_params alter column tp_pct set not null;
alter table strategy_params alter column sl_pct set not null;
alter table strategy_params alter column win_rate set not null;
alter table strategy_params alter column trade_count set not null;
alter table strategy_params alter column last_tested set not null;
alter table strategy_params alter column is_active set not null;


-- ----------------------------------------------------------------------------
-- 45. Index sur les requêtes chaudes (audit du 01/08/2026)
--     Trois filtres tournent à CHAQUE cycle cron sans index dédié. Sans effet
--     à quelques utilisateurs, mais ce sont exactement les requêtes qui
--     dégradent en premier quand la base grossit — donc à poser avant la
--     croissance, pas après.
-- ----------------------------------------------------------------------------

-- users.expiration : filtre "abonnement encore actif" (expiration > now()).
-- Utilisé par la diffusion des signaux, les relances d'expiration, /trust et
-- les statistiques — soit plusieurs fois par cycle de 5 minutes.
create index if not exists idx_users_expiration on users (expiration);

-- Variante partielle pour le décompte des abonnés PAYANTS actifs
-- (plan_started_at non nul + non expiré), utilisé par /trust et /stats.
create index if not exists idx_users_active_paying
  on users (expiration) where plan_started_at is not null;

-- signals.created_at : balayage par fenêtre temporelle. Chemin le plus
-- fréquent depuis le correctif de rattrapage du 01/08 —
-- storage.pairs_signalled_since() interroge cette colonne à chaque exécution
-- du générateur (toutes les 30 min), en plus du récap hebdomadaire et du
-- récapitulatif de relance.
create index if not exists idx_signals_created_at on signals (created_at desc);

-- Contrainte CHECK de pending_actions : le flux /review écrit
-- 'awaiting_review_comment' (voir workers/main-worker/src/db/pendingActions.ts)
-- alors que la contrainte d'origine (section 7) n'autorisait que les deux
-- valeurs liées au wallet. Résultat mesuré en production le 01/08/2026 :
-- erreur 23514 à chaque note laissée via /review — la note était enregistrée,
-- mais l'exception coupait le remerciement et l'utilisateur voyait « une
-- erreur temporaire est survenue ». Le code dégrade désormais proprement,
-- mais le commentaire libre reste impossible tant que cette contrainte n'est
-- pas élargie.
alter table pending_actions drop constraint if exists pending_actions_action_type_check;
alter table pending_actions add constraint pending_actions_action_type_check
  check (action_type in ('awaiting_wallet_usdt', 'awaiting_wallet_trial', 'awaiting_review_comment'));

-- Colonne utilisée par le même flux (identifiant de la note à compléter).
alter table pending_actions add column if not exists review_id bigint;
