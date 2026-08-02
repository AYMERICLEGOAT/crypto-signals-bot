"""
Momentum transversal (cross-sectional) sur l'univers des 40 paires.

Pourquoi cette famille et pas une autre. Les ~35 pistes déjà explorées
partagent toutes le même schéma : un signal ABSOLU calculé paire par paire
(croisement, seuil d'indicateur, cassure), évalué en intraday. Toutes ont
échoué, et le test des unités de temps a montré pourquoi — le signal se
dégrade quand le bruit diminue, signature d'une absence de pouvoir
prédictif.

Le momentum transversal est structurellement différent sur trois points :

  1. Il est RELATIF, pas absolu : on ne demande pas « BTC va-t-il monter ? »
     mais « parmi 40 actifs, lesquels surperforment ? ». La question relative
     est empiriquement plus stable que la question directionnelle.
  2. Il est à FAIBLE ROTATION : rééquilibrage hebdomadaire ou bimensuel, donc
     quelques trades par semaine au lieu de 2,4 par jour. C'est décisif quand
     les frais sont la contrainte dominante — moins de rotations, moins de
     frais payés.
  3. Il capture des mouvements LONGS (plusieurs jours à plusieurs semaines),
     face auxquels 0,10 % de frais devient marginal, au lieu de mouvements
     intraday de quelques dixièmes de pourcent.

Le module balaie les paramètres (fenêtre de classement, nombre de positions,
période de détention) et mesure systématiquement le rendement NET de frais,
avec walk-forward en 4 périodes de 6 mois. Critère de retenue inchangé :
positif net de frais sur les QUATRE périodes.

Usage : python backtest_cross_momentum.py
"""

import itertools
import json
import logging
import os

import pandas as pd

import config
import binance_client

logging.basicConfig(level=logging.WARNING, format="%(message)s")

DAYS = 730
N_PERIODS = 4
# Réutilise le cache journalier déjà constitué par backtest_timeframes.py.
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "tf_cache")
FEE_ONE_WAY_PCT = 0.05  # 0,10 % l'aller-retour


def load_daily():
    """Prix de clôture journaliers, alignés sur un index de dates commun."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    series = {}
    for pair in config.PAIRS:
        symbol = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbol}_1d_{DAYS}d.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                candles = json.load(f)
        else:
            candles = binance_client.get_historical_klines(symbol, interval="1d", days=DAYS)
            if candles:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(candles, f)
        if not candles or len(candles) < 200:
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
        df["date"] = pd.to_datetime(df["ts_ms"], unit="ms").dt.normalize()
        series[pair] = df.set_index("date")["price"].astype(float)
    if not series:
        return None
    prices = pd.DataFrame(series).sort_index()
    # Une paire listée tardivement laisse des NaN en début de période : on ne
    # les remplit pas (ce serait inventer un historique), on les exclura du
    # classement date par date.
    return prices


def simulate(prices, lookback, n_hold, rebal_days, skip_recent=0):
    """
    Rendement d'un portefeuille équipondéré des `n_hold` meilleures paires
    selon leur performance sur `lookback` jours, rééquilibré tous les
    `rebal_days` jours.

    `skip_recent` : ignore les N derniers jours dans le calcul du momentum
    (pratique standard en actions pour éviter le retournement court terme).

    Strictement causal : le classement à la date t n'utilise que des prix
    <= t, et la performance est mesurée APRÈS, sur la période de détention.
    """
    dates = prices.index
    start = lookback + skip_recent + 1
    if len(dates) <= start + rebal_days:
        return None

    equity = [1.0]
    held = set()
    n_trades = 0
    period_returns = []

    for i in range(start, len(dates) - rebal_days, rebal_days):
        # Classement causal : rendement entre t-lookback-skip et t-skip.
        past = prices.iloc[i - lookback - skip_recent]
        recent = prices.iloc[i - skip_recent] if skip_recent else prices.iloc[i]
        momentum = (recent - past) / past
        momentum = momentum.dropna()
        # Écarte les paires sans prix valide à l'entrée ou à la sortie.
        entry = prices.iloc[i]
        exit_ = prices.iloc[i + rebal_days]
        valid = momentum.index[entry[momentum.index].notna() & exit_[momentum.index].notna()]
        momentum = momentum[valid]
        if len(momentum) < n_hold:
            continue

        picks = set(momentum.nlargest(n_hold).index)

        # Rotation : seules les positions qui changent coûtent des frais.
        changed = len(picks - held) + len(held - picks)
        n_trades += changed
        fee_cost = (changed / max(1, n_hold)) * (FEE_ONE_WAY_PCT / 100.0)

        ret = ((exit_[list(picks)] - entry[list(picks)]) / entry[list(picks)]).mean()
        net = ret - fee_cost
        period_returns.append(net)
        equity.append(equity[-1] * (1 + net))
        held = picks

    if not period_returns:
        return None

    eq = pd.Series(equity)
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100
    n_years = (len(dates) - start) / 365.0
    total = (eq.iloc[-1] - 1) * 100
    return {
        "rebalances": len(period_returns),
        "trades": n_trades,
        "trades_par_jour": n_trades / max(1, (len(dates) - start)),
        "moyenne_par_rebal": sum(period_returns) / len(period_returns) * 100,
        "total_net": total,
        "annualise": ((eq.iloc[-1] ** (1 / max(0.1, n_years))) - 1) * 100,
        "positifs": 100 * sum(1 for r in period_returns if r > 0) / len(period_returns),
        "drawdown": dd,
    }


def slice_period(prices, i, n):
    size = len(prices) // n
    return prices.iloc[i * size:(i + 1) * size]


print("Chargement des bougies journalières...", flush=True)
prices = load_daily()
if prices is None:
    raise SystemExit("aucune donnée")
print(f"{prices.shape[1]} paires, {prices.shape[0]} jours "
      f"({prices.index[0].date()} -> {prices.index[-1].date()})\n", flush=True)

LOOKBACKS = [7, 14, 30, 60, 90]
HOLDS = [3, 5, 10]
REBALS = [7, 14, 30]

print(f"{len(LOOKBACKS)*len(HOLDS)*len(REBALS)} combinaisons, frais {FEE_ONE_WAY_PCT*2}%/aller-retour\n", flush=True)
print(f"{'fenêtre':>8} {'top':>4} {'rebal':>6} | {'net total':>10} {'annualisé':>10} "
      f"{'%rebal+':>8} {'DD':>7} {'trades/j':>9}", flush=True)

rows = []
for lb, nh, rb in itertools.product(LOOKBACKS, HOLDS, REBALS):
    m = simulate(prices, lb, nh, rb)
    if not m:
        continue
    rows.append(((lb, nh, rb), m))
    print(f"{lb:>8} {nh:>4} {rb:>6} | {m['total_net']:>9.1f}% {m['annualise']:>9.1f}% "
          f"{m['positifs']:>7.0f}% {m['drawdown']:>6.1f}% {m['trades_par_jour']:>9.2f}", flush=True)

if not rows:
    raise SystemExit("\naucune combinaison exploitable")

rows.sort(key=lambda r: -r[1]["annualise"])
print("\n=== MEILLEURES COMBINAISONS (rendement annualisé net) ===")
for (lb, nh, rb), m in rows[:5]:
    print(f"  fenêtre {lb}j, top {nh}, rebal {rb}j : {m['annualise']:+.1f}%/an net, "
          f"DD {m['drawdown']:.1f}%, {m['trades_par_jour']:.2f} trades/jour")

print("\n=== WALK-FORWARD des 3 meilleures (4 périodes de 6 mois) ===")
for (lb, nh, rb), _ in rows[:3]:
    print(f"\nfenêtre {lb}j / top {nh} / rebal {rb}j :")
    per = []
    for i in range(N_PERIODS):
        m = simulate(slice_period(prices, i, N_PERIODS), lb, nh, rb)
        per.append(m)
        if m:
            print(f"  P{i+1} : {m['total_net']:+7.1f}% net | {m['positifs']:.0f}% de rebal. positifs "
                  f"| DD {m['drawdown']:.1f}%")
        else:
            print(f"  P{i+1} : période trop courte pour cette fenêtre")
    ok = [p for p in per if p]
    stable = len(ok) == N_PERIODS and all(p["total_net"] > 0 for p in ok)
    print(f"  -> positif sur les 4 périodes : {'OUI' if stable else 'non'}")


def simulate_neutral(prices, lookback, n_hold, rebal_days):
    """
    Variante NEUTRE AU MARCHÉ : long les `n_hold` meilleures, short les
    `n_hold` pires, à pondération égale.

    Motif : la version long-only s'est révélée être du BÊTA pur — +239 % à
    +394 % sur la période haussière, -17 % à -52 % sur les deux baissières.
    Elle ne fait que détenir de la crypto avec des frais en plus.

    Prendre les deux côtés annule l'essentiel de l'exposition directionnelle :
    ce qui reste est l'alpha transversal, s'il existe. C'est le test décisif
    de l'hypothèse « le classement relatif contient de l'information », par
    opposition à « le marché a monté ».
    """
    dates = prices.index
    start = lookback + 1
    if len(dates) <= start + rebal_days:
        return None

    equity = [1.0]
    held_long, held_short = set(), set()
    n_trades = 0
    period_returns = []

    for i in range(start, len(dates) - rebal_days, rebal_days):
        past = prices.iloc[i - lookback]
        now = prices.iloc[i]
        momentum = ((now - past) / past).dropna()
        entry, exit_ = prices.iloc[i], prices.iloc[i + rebal_days]
        valid = momentum.index[entry[momentum.index].notna() & exit_[momentum.index].notna()]
        momentum = momentum[valid]
        if len(momentum) < n_hold * 2:
            continue

        longs = set(momentum.nlargest(n_hold).index)
        shorts = set(momentum.nsmallest(n_hold).index)

        changed = (len(longs - held_long) + len(held_long - longs)
                   + len(shorts - held_short) + len(held_short - shorts))
        n_trades += changed
        fee_cost = (changed / max(1, n_hold * 2)) * (FEE_ONE_WAY_PCT / 100.0)

        ret_l = ((exit_[list(longs)] - entry[list(longs)]) / entry[list(longs)]).mean()
        ret_s = ((entry[list(shorts)] - exit_[list(shorts)]) / entry[list(shorts)]).mean()
        # Capital réparti sur les deux jambes.
        net = (ret_l + ret_s) / 2 - fee_cost
        period_returns.append(net)
        equity.append(equity[-1] * (1 + net))
        held_long, held_short = longs, shorts

    if not period_returns:
        return None
    eq = pd.Series(equity)
    dd = ((eq - eq.cummax()) / eq.cummax()).min() * 100
    n_years = (len(dates) - start) / 365.0
    return {
        "trades_par_jour": n_trades / max(1, (len(dates) - start)),
        "total_net": (eq.iloc[-1] - 1) * 100,
        "annualise": ((max(0.01, eq.iloc[-1]) ** (1 / max(0.1, n_years))) - 1) * 100,
        "positifs": 100 * sum(1 for r in period_returns if r > 0) / len(period_returns),
        "drawdown": dd,
    }


print("\n\n" + "=" * 70)
print("VARIANTE NEUTRE AU MARCHÉ (long les meilleures / short les pires)")
print("=" * 70)
print("La version long-only s'est révélée être du bêta pur. Prendre les deux")
print("côtés annule la direction du marché : ce qui reste est l'alpha, s'il existe.\n")
print(f"{'fenêtre':>8} {'top':>4} {'rebal':>6} | {'net total':>10} {'annualisé':>10} "
      f"{'%rebal+':>8} {'DD':>7} {'trades/j':>9}", flush=True)

neutral_rows = []
for lb, nh, rb in itertools.product(LOOKBACKS, HOLDS, REBALS):
    m = simulate_neutral(prices, lb, nh, rb)
    if not m:
        continue
    neutral_rows.append(((lb, nh, rb), m))
    print(f"{lb:>8} {nh:>4} {rb:>6} | {m['total_net']:>9.1f}% {m['annualise']:>9.1f}% "
          f"{m['positifs']:>7.0f}% {m['drawdown']:>6.1f}% {m['trades_par_jour']:>9.2f}", flush=True)

if neutral_rows:
    neutral_rows.sort(key=lambda r: -r[1]["annualise"])
    positifs = [r for r in neutral_rows if r[1]["annualise"] > 0]
    print(f"\n{len(positifs)}/{len(neutral_rows)} combinaisons positives "
          f"(le hasard en donnerait ~{len(neutral_rows)//2})")
    print("\n=== WALK-FORWARD des 3 meilleures ===")
    for (lb, nh, rb), _ in neutral_rows[:3]:
        print(f"\nfenêtre {lb}j / top {nh} / rebal {rb}j :")
        per = []
        for i in range(N_PERIODS):
            m = simulate_neutral(slice_period(prices, i, N_PERIODS), lb, nh, rb)
            per.append(m)
            if m:
                print(f"  P{i+1} : {m['total_net']:+7.1f}% net | {m['positifs']:.0f}% rebal. positifs "
                      f"| DD {m['drawdown']:.1f}%")
            else:
                print(f"  P{i+1} : periode trop courte")
        ok = [x for x in per if x]
        stable = len(ok) == N_PERIODS and all(x["total_net"] > 0 for x in ok)
        print(f"  -> positif sur les 4 periodes : {'OUI' if stable else 'non'}")
