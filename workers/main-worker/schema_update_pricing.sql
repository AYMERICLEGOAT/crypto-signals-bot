-- Nouvelle grille tarifaire (Découverte/Standard/Pro) et Effet Sniper.

-- Anti-abus "une seule fois par wallet" pour le Pack Découverte (5 USDT/14j),
-- même principe que hasWalletClaimedTrial pour /trial.
alter table users add column if not exists discovery_used boolean not null default false;

-- Effet Sniper : les Pro reçoivent le signal immédiatement (sent=true comme
-- aujourd'hui), les Standard/Découverte 15 minutes plus tard (nouveau flag,
-- même principe que sent_to_channel pour le canal public).
alter table signals add column if not exists sent_to_standard boolean not null default false;
