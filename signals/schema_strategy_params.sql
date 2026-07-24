-- Historique des paramètres de stratégie retenus par backtest.py.
-- Une seule ligne "is_active = true" à la fois : c'est celle que main.py
-- charge au démarrage (remplace l'ancien fichier local data/optimized_params.json,
-- qui ne survit pas entre deux exécutions GitHub Actions).
--
-- Reflète le schéma réellement déployé (voir params_store.py) : pas de
-- colonnes gain_loss_ratio / max_drawdown_pct / pairs_tested — ces mesures
-- restent uniquement dans les logs de backtest.py.

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
