"""
Vérification finale : la vraie courbe de capital, contre l'achat-conservation.

Pourquoi ce module malgré tous les précédents. La mesure signal par signal
donne +3,33 % d'espérance par signal sur 7 jours avec le filtre BTC > MM200.
Extrapoler naïvement donnerait plus de 100 % par an. C'est faux, et le piège
est classique : la moyenne ARITHMÉTIQUE des rendements surestime la croissance
COMPOSÉE dès que la volatilité est forte. Une position qui fait +50 % puis
-50 % a une moyenne de 0 % et un résultat de -25 %. Avec des signaux dont le
meilleur atteint +478 %, l'écart entre les deux mesures est énorme.

Seule la courbe de capital effectivement composée compte. Elle est comparée
ici à la seule alternative honnête : acheter l'univers équipondéré et ne rien
faire, ce qui ne coûte ni frais ni travail ni abonnement.

Le module mesure aussi ce que personne n'aime regarder : le drawdown maximal,
la plus longue série perdante, et le temps passé sous le plus haut. Ce sont
ces chiffres-là qui font qu'un abonné part ou reste, bien plus que le
rendement annualisé.

Configuration jugée : classement par force relative sur l'univers des paires
déjà cotées avant 2020, filtre de tendance BTC > MM200, entrée décalée d'un
jour, 0,10 % de frais aller-retour, capital réparti équitablement entre les
positions ouvertes.

Usage : python backtest_final_portefeuille.py
"""

import pandas as pd

from fetch_long_history import load_long_daily
from backtest_rsi_inverse import rsi_frame

START = "2020-08-11"
FEE_ONE_WAY = 0.0005  # 0,05 % à l'aller comme au retour


def simulate_portfolio(prices, rank_frame, n_hold, hold_days, trend_mask, delay=1):
    """
    Portefeuille réel : au plus `n_hold` positions, chacune détenue exactement
    `hold_days` jours, capital réparti à parts égales entre les emplacements.

    Chaque emplacement libre est réattribué au mieux classé disponible, à
    condition que le filtre de tendance soit ouvert le jour du signal. Le
    capital d'un emplacement non pourvu reste en liquide et ne rapporte rien.
    """
    dates = prices.index
    slot_value = [1.0 / n_hold] * n_hold
    slot_pos = [None] * n_hold  # (paire, prix d'entrée, index de sortie)
    curve = []
    n_trades = 0

    for i in range(30, len(dates) - delay):
        d = dates[i]

        # 1. Clôtures arrivées à échéance
        for k, pos in enumerate(slot_pos):
            if pos and i >= pos[2]:
                pair, entry, _ = pos
                px = prices[pair].iloc[i]
                if pd.notna(px) and entry > 0:
                    slot_value[k] *= (px / entry) * (1 - FEE_ONE_WAY)
                slot_pos[k] = None

        # 2. Ouvertures, si le filtre de tendance est ouvert
        free = [k for k, p in enumerate(slot_pos) if p is None]
        if free and bool(trend_mask.get(d, False)) and i + delay < len(dates):
            rank = rank_frame.iloc[i].dropna()
            entry_row = prices.iloc[i + delay]
            rank = rank[rank.index[entry_row[rank.index].notna()]]
            occupied = {p[0] for p in slot_pos if p}
            candidates = [c for c in rank.sort_values(ascending=False).index if c not in occupied]
            for k in free:
                if not candidates:
                    break
                pair = candidates.pop(0)
                entry = prices[pair].iloc[i + delay]
                if pd.isna(entry) or entry <= 0:
                    continue
                slot_value[k] *= (1 - FEE_ONE_WAY)
                slot_pos[k] = (pair, entry, i + delay + hold_days)
                n_trades += 1

        # 3. Valorisation au prix du jour
        total = 0.0
        for k, pos in enumerate(slot_pos):
            if pos:
                pair, entry, _ = pos
                px = prices[pair].iloc[i]
                total += slot_value[k] * (px / entry if pd.notna(px) and entry > 0 else 1.0)
            else:
                total += slot_value[k]
        curve.append((d, total))

    return pd.Series(dict(curve)), n_trades


def buy_and_hold_curve(prices):
    """Équipondéré, acheté au début, jamais touché."""
    rets = prices.pct_change().mean(axis=1).fillna(0.0)
    return (1 + rets).cumprod()


def describe(curve, label, n_trades=None):
    if curve.empty:
        print(f"  {label} : courbe vide")
        return None
    years = (curve.index[-1] - curve.index[0]).days / 365.25
    final = curve.iloc[-1]
    cagr = (max(final, 1e-9) ** (1 / years) - 1) * 100
    dd = (curve - curve.cummax()) / curve.cummax()
    daily = curve.pct_change().dropna()
    vol = daily.std() * (365 ** 0.5) * 100
    sharpe = (cagr / vol) if vol > 0 else 0.0

    # Temps passé sous le plus haut précédent
    sous_leau = 100 * (dd < -0.01).mean()
    # Plus longue série de jours consécutifs sous le plus haut
    longest = cur = 0
    for v in (dd < -0.01):
        cur = cur + 1 if v else 0
        longest = max(longest, cur)

    print(f"  {label}")
    print(f"    Capital final    : x{final:.2f}  ({(final - 1) * 100:+.0f} %)")
    print(f"    Annualisé (CAGR) : {cagr:+.1f} %/an")
    print(f"    Volatilité       : {vol:.0f} %/an   |   ratio rendement/risque : {sharpe:.2f}")
    print(f"    Drawdown maximal : {dd.min() * 100:.1f} %")
    print(f"    Temps sous le plus haut : {sous_leau:.0f} % des jours, "
          f"série la plus longue {longest} jours ({longest / 30:.1f} mois)")
    if n_trades is not None:
        print(f"    Trades           : {n_trades} ({n_trades / years / 52:.1f} par semaine)")
    return {"cagr": cagr, "dd": dd.min() * 100, "final": final, "sharpe": sharpe}


print("Chargement...", flush=True)
full = load_long_daily(verbose=False)
prices = full.loc[START:]
old = [c for c in full.columns
       if full[c].first_valid_index() is not None and full[c].first_valid_index().year <= 2019]
sub = prices[old]

btc = full["BTC/USDT"]
mm200 = (btc > btc.rolling(200).mean()).reindex(prices.index).fillna(False).to_dict()
toujours = {d: True for d in prices.index}
rank = rsi_frame(sub, 21)

print(f"{len(old)} paires pré-2020, {prices.index[0].date()} -> {prices.index[-1].date()}")
print(f"Filtre BTC > MM200 ouvert {100 * sum(mm200.values()) / len(mm200):.0f} % du temps\n")

print("=== COURBES DE CAPITAL RÉELLEMENT COMPOSÉES ===\n")
bh = buy_and_hold_curve(sub)
r_bh = describe(bh, "Acheter l'univers et ne rien faire (le concurrent honnête)")

print()
c_nf, t_nf = simulate_portfolio(sub, rank, 5, 7, toujours)
r_nf = describe(c_nf, "Force relative, top 5 / 7 jours, SANS filtre", t_nf)

print()
c_f, t_f = simulate_portfolio(sub, rank, 5, 7, mm200)
r_f = describe(c_f, "Force relative, top 5 / 7 jours, AVEC filtre BTC > MM200", t_f)

print("\n=== VARIANTES, TOUTES AVEC LE FILTRE ===")
print(f"{'top':>4} {'détention':>10} | {'CAGR':>9} | {'drawdown':>9} | {'rend/risque':>12} | "
      f"{'trades/sem':>11} | {'x capital':>10}")
variantes = {}
for nh in (3, 5, 8, 12):
    for hold in (7, 14, 21):
        c, t = simulate_portfolio(sub, rank, nh, hold, mm200)
        if c.empty:
            continue
        years = (c.index[-1] - c.index[0]).days / 365.25
        cagr = (max(c.iloc[-1], 1e-9) ** (1 / years) - 1) * 100
        dd = ((c - c.cummax()) / c.cummax()).min() * 100
        vol = c.pct_change().dropna().std() * (365 ** 0.5) * 100
        variantes[(nh, hold)] = (cagr, dd, c)
        print(f"{nh:>4} {hold:>9}j | {cagr:>+8.1f}% | {dd:>8.1f}% | {cagr / vol if vol else 0:>12.2f} | "
              f"{t / years / 52:>10.1f}  | {c.iloc[-1]:>9.2f}x")

print("\n=== ANNÉE PAR ANNÉE, LE VERDICT ===")
print("Rendement composé réel de chaque année civile, filtre actif, top 5 / 7 jours,")
print("comparé à l'achat-conservation sur le même univers.\n")
print(f"{'année':>6} | {'stratégie':>11} | {'achat-conservation':>20} | {'écart':>9}")
n_strat_pos = n_bat = n_tot = 0
for y in sorted({d.year for d in c_f.index}):
    a = c_f[c_f.index.year == y]
    b = bh[bh.index.year == y]
    if len(a) < 60:
        continue
    ra = (a.iloc[-1] / a.iloc[0] - 1) * 100
    rb = (b.iloc[-1] / b.iloc[0] - 1) * 100
    n_tot += 1
    n_strat_pos += ra > 0
    n_bat += ra > rb
    print(f"{y:>6} | {ra:>+10.1f}% | {rb:>+19.1f}% | {ra - rb:>+8.1f}pt")
print(f"\n  Stratégie positive        : {n_strat_pos}/{n_tot} années")
print(f"  Stratégie bat l'achat-cons: {n_bat}/{n_tot} années")

print("\n=== CE QUE ÇA DONNE POUR UN ABONNÉ QUI ENTRE AU PIRE MOMENT ===")
print("Un abonné n'entre pas au début de la courbe : il entre un jour au hasard.")
print("Voici la distribution de son résultat après 3 et 6 mois.\n")
for horizon, label in ((90, "3 mois"), (180, "6 mois")):
    rolls = (c_f.shift(-horizon) / c_f - 1).dropna() * 100
    rolls_bh = (bh.shift(-horizon) / bh - 1).dropna() * 100
    if rolls.empty:
        continue
    print(f"  Après {label} :")
    print(f"    Stratégie          : médiane {rolls.median():+.1f}%, "
          f"{100 * (rolls > 0).mean():.0f}% des entrées gagnantes, "
          f"pire cas {rolls.min():+.1f}%")
    print(f"    Achat-conservation : médiane {rolls_bh.median():+.1f}%, "
          f"{100 * (rolls_bh > 0).mean():.0f}% des entrées gagnantes, "
          f"pire cas {rolls_bh.min():+.1f}%")
