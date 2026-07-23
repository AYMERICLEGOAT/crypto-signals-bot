-- Historique des paramètres de stratégie retenus par backtest.py.
-- Une seule ligne "is_active = true" à la fois : c'est celle que main.py
-- charge au démarrage (remplace l'ancien fichier local data/optimized_params.json,
-- qui ne survit pas entre deux exécutions GitHub Actions).

create table if not exists strategy_params (
    id                 bigserial primary key,
    ema_fast           integer not null,
    ema_slow           integer not null,
    rsi_buy_threshold  integer not null,
    rsi_sell_threshold integer not null,
    total_trades       integer not null,
    global_win_rate    numeric not null,
    gain_loss_ratio    numeric,
    max_drawdown_pct   numeric,
    source             text not null,
    pairs_tested       text not null,
    is_active          boolean not null default true,
    created_at         timestamptz not null default now()
);

create index if not exists idx_strategy_params_active on strategy_params (is_active) where is_active = true;
