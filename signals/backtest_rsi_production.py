"""
La forme livrable : classement RSI, long-only, mesuré signal par signal.

Où on en est. Le classement transversal par RSI a survécu à tout ce qui a tué
les ~35 pistes précédentes : 18/18 combinaisons positives sur 6 ans, 18/18
avec un jour de délai d'exécution, 18/18 sur l'univers restreint aux paires
déjà cotées avant 2020, 17 trimestres positifs sur 23, et il bat l'équipondéré
acheté-conservé sur 18/18. Le sens actuellement en production — acheter les
RSI bas — est la jambe perdante.

Ce que ce module mesure, et pourquoi. Les chiffres précédents sont des courbes
de capital, utiles pour juger une stratégie mais inutilisables pour piloter un
canal de signaux. Ce qu'il faut savoir ici est différent :

  - combien de signaux par semaine (la contrainte « quantité ») ;
  - quel pourcentage finit gagnant (ce qui sera annoncé aux abonnés, donc ce
    qui doit être exact au point près) ;
  - combien rapporte un gagnant, combien coûte un perdant ;
  - ce que ça donne face à « acheter et ne rien faire », le seul concurrent
    honnête.

Contrôle indispensable. Le RSI haut est corrélé à la performance passée : une
paire au RSI élevé est une paire qui vient de monter. Il faut donc vérifier si
le RSI apporte quoi que ce soit qu'un simple classement par rendement passé
n'apporterait pas. Si les deux donnent la même chose, autant garder le plus
simple, et surtout ne pas raconter aux abonnés que le RSI est le secret.

Toutes les mesures intègrent un jour de délai entre le signal et l'entrée, et
0,10 % de frais aller-retour.

Usage : python backtest_rsi_production.py
"""

import itertools

import pandas as pd

from fetch_long_history import load_long_daily
from backtest_rsi_inverse import rsi_frame

FEE_ROUND_TRIP_PCT = 0.10
START = "2020-08-11"
MIN_PAIRS = 15


def momentum_frame(prices, window):
    """Rendement sur `window` jours : le classement le plus simple possible."""
    return prices.pct_change(window)


def collect_signals(prices, rank_frame, n_hold, hold_days, delay=1):
    """
    Émet un signal d'ACHAT chaque fois qu'une paire entre dans le groupe de
    tête, et le clôture `hold_days` jours plus tard.

    Le classement est lu à la clôture du jour i ; l'entrée se fait à la
    clôture du jour i + delay. Aucune exécution instantanée n'est supposée.
    Une paire déjà détenue qui reste dans le groupe de tête ne redéclenche pas
    de signal : on ne compte que les entrées réelles.
    """
    dates = prices.index
    signals = []
    held = {}  # paire -> index de sortie prévu

    for i in range(30, len(dates) - hold_days - delay):
        for pair, exit_idx in list(held.items()):
            if i >= exit_idx:
                del held[pair]

        rank = rank_frame.iloc[i].dropna()
        entry_row = prices.iloc[i + delay]
        valid = rank.index[entry_row[rank.index].notna()]
        rank = rank[valid]
        if len(rank) < MIN_PAIRS:
            continue

        for pair in rank.nlargest(n_hold).index:
            if pair in held:
                continue
            e_idx, x_idx = i + delay, i + delay + hold_days
            if x_idx >= len(dates):
                continue
            entry, exit_ = prices[pair].iloc[e_idx], prices[pair].iloc[x_idx]
            if pd.isna(entry) or pd.isna(exit_) or entry <= 0:
                continue
            held[pair] = x_idx
            signals.append({
                "pair": pair,
                "date": dates[e_idx],
                "gain_pct": (exit_ - entry) / entry * 100 - FEE_ROUND_TRIP_PCT,
            })
    return pd.DataFrame(signals)


def stats(sig, n_days):
    if sig.empty:
        return None
    g = sig["gain_pct"]
    wins, losses = g[g > 0], g[g <= 0]
    return {
        "n": len(g),
        "par_semaine": len(g) / (n_days / 7),
        "reussite": 100 * len(wins) / len(g),
        "gain_moyen": g.mean(),
        "gagnant_moyen": wins.mean() if len(wins) else 0.0,
        "perdant_moyen": losses.mean() if len(losses) else 0.0,
        "meilleur": g.max(),
        "pire": g.min(),
        "esperance": g.mean(),
    }


def show(label, s):
    if not s:
        print(f"  {label} : aucun signal")
        return
    print(f"  {label}")
    print(f"    {s['n']} signaux  ({s['par_semaine']:.1f} par semaine)")
    print(f"    Réussite      : {s['reussite']:.1f} %")
    print(f"    Espérance     : {s['esperance']:+.2f} % par signal, net de frais")
    print(f"    Gagnant moyen : {s['gagnant_moyen']:+.2f} %   |   Perdant moyen : {s['perdant_moyen']:+.2f} %")
    print(f"    Meilleur      : {s['meilleur']:+.1f} %   |   Pire : {s['pire']:+.1f} %")


if __name__ == "__main__":
    print("Chargement...", flush=True)
    full = load_long_daily(verbose=False)
    prices = full.loc[START:]
    n_days = len(prices)
    print(f"{prices.shape[1]} paires, {prices.index[0].date()} -> {prices.index[-1].date()}\n")

    # Univers non contaminé : paires déjà cotées avant 2020, donc non choisies
    # en connaissant leur avenir. C'est l'univers sur lequel on conclura.
    old = [c for c in full.columns
           if full[c].first_valid_index() is not None and full[c].first_valid_index().year <= 2019]
    sub = prices[old]

    # --- 1. Le témoin : acheter et ne rien faire ---
    bh = ((prices.iloc[-1] / prices.iloc[0]).dropna() - 1) * 100
    bh_sub = ((sub.iloc[-1] / sub.iloc[0]).dropna() - 1) * 100
    years = n_days / 365
    print("=== TÉMOIN : ACHETER ET NE RIEN FAIRE ===")
    print(f"  Univers complet ({len(bh)} paires)  : {bh.mean():+.0f}% sur {years:.1f} ans, "
          f"soit {((1 + bh.mean()/100) ** (1/years) - 1) * 100:+.1f} %/an")
    print(f"  Univers pré-2020 ({len(bh_sub)} paires) : {bh_sub.mean():+.0f}% sur {years:.1f} ans, "
          f"soit {((1 + bh_sub.mean()/100) ** (1/years) - 1) * 100:+.1f} %/an")
    print(f"  {100 * (bh_sub > 0).mean():.0f}% des paires pré-2020 sont en hausse sur la période")

    # --- 2. Les deux sens, en comptant les signaux un par un ---
    print("\n=== LES DEUX SENS, SIGNAL PAR SIGNAL (univers pré-2020, délai 1 jour) ===")
    CONFIGS = [(3, 7), (5, 7), (5, 14), (8, 7), (8, 14), (12, 7)]
    rsi21 = rsi_frame(sub, 21)
    for nh, hold in CONFIGS:
        print(f"\n--- top {nh}, détention {hold} jours ---")
        haut = collect_signals(sub, rsi21, nh, hold)
        bas = collect_signals(sub, -rsi21, nh, hold)  # inverser le classement = RSI bas
        show("RSI HAUT (nouvelle thèse)", stats(haut, n_days))
        show("RSI BAS  (production actuelle)", stats(bas, n_days))

    # --- 3. Le RSI est-il autre chose qu'un proxy de la performance passée ? ---
    print("\n=== CONTRÔLE : LE RSI APPORTE-T-IL QUELQUE CHOSE DE PLUS ? ===")
    print("Une paire au RSI élevé est une paire qui vient de monter. Si un simple")
    print("classement par rendement passé fait aussi bien, le RSI n'est pas le secret.\n")
    nh, hold = 5, 7
    print(f"{'classement':>28} | {'signaux/sem':>12} | {'réussite':>9} | {'espérance':>11}")
    variants = {
        "RSI(7)": rsi_frame(sub, 7),
        "RSI(14)": rsi_frame(sub, 14),
        "RSI(21)": rsi_frame(sub, 21),
        "rendement 7 jours": momentum_frame(sub, 7),
        "rendement 14 jours": momentum_frame(sub, 14),
        "rendement 30 jours": momentum_frame(sub, 30),
        "rendement 90 jours": momentum_frame(sub, 90),
    }
    for name, frame in variants.items():
        s = stats(collect_signals(sub, frame, nh, hold), n_days)
        if s:
            print(f"{name:>28} | {s['par_semaine']:>11.1f}  | {s['reussite']:>8.1f}% | "
                  f"{s['esperance']:>+10.2f}%")

    # --- 4. Stabilité année par année de la configuration retenue ---
    print(f"\n=== STABILITÉ ANNUELLE (RSI(21), top {nh}, détention {hold} jours) ===")
    print("Une espérance moyenne flatteuse peut cacher une seule bonne année.\n")
    sig = collect_signals(sub, rsi21, nh, hold)
    sig_bas = collect_signals(sub, -rsi21, nh, hold)
    print(f"{'année':>6} | {'signaux':>8} | {'réussite':>9} | {'espérance':>11} | "
          f"{'espérance BAS':>14} | {'écart':>8}")
    n_pos = 0
    rows = 0
    for y in sorted(sig["date"].dt.year.unique()):
        a = sig[sig["date"].dt.year == y]["gain_pct"]
        b = sig_bas[sig_bas["date"].dt.year == y]["gain_pct"]
        if len(a) < 10:
            continue
        rows += 1
        n_pos += a.mean() > 0
        print(f"{y:>6} | {len(a):>8} | {100 * (a > 0).mean():>8.1f}% | {a.mean():>+10.2f}% | "
              f"{(b.mean() if len(b) else 0):>+13.2f}% | {(a.mean() - (b.mean() if len(b) else 0)):>+7.2f}pt")
    print(f"\n  -> espérance positive sur {n_pos}/{rows} années")

    # --- 5. Combien de signaux si on ouvre les vannes ? ---
    print("\n=== ARBITRAGE QUANTITÉ / QUALITÉ ===")
    print("Élargir le groupe de tête produit plus de signaux mais dilue la sélection.")
    print("Le tableau donne le prix exact de chaque signal supplémentaire.\n")
    print(f"{'top':>5} {'détention':>10} | {'signaux/sem':>12} | {'réussite':>9} | "
          f"{'espérance':>11} | {'%/an approx':>12}")
    for nh2 in (3, 5, 8, 12, 18):
        for hold2 in (7, 14):
            if nh2 > len(old):
                continue
            s = stats(collect_signals(sub, rsi_frame(sub, 21), nh2, hold2), n_days)
            if not s:
                continue
            # Rendement annuel approché : espérance par signal x rotations par an,
            # à capital pleinement investi réparti sur nh2 positions.
            approx = s["esperance"] * (365.0 / hold2)
            print(f"{nh2:>5} {hold2:>9}j | {s['par_semaine']:>11.1f}  | {s['reussite']:>8.1f}% | "
                  f"{s['esperance']:>+10.2f}% | {approx:>+11.1f}%")
