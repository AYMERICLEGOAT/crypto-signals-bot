"""
Télécharge l'historique journalier MAXIMUM disponible pour les 40 paires.

Pourquoi. Tous les backtests du projet tournent sur 730 jours, non pas parce
que c'est la donnée disponible mais parce que DAYS = 730 est écrit en dur dans
backtest_cross_momentum.py. Avec un rééquilibrage hebdomadaire, 730 jours ne
font que ~104 observations, et 52 une fois coupés en deux pour le hors
échantillon. À ce niveau, un avantage réel de 1 %/semaine et du bruit pur sont
mathématiquement indiscernables : les tests ne réfutent rien, ils manquent
simplement de puissance, et on lit ce silence comme un rejet.

Binance sert les bougies journalières depuis 2017 sur son endpoint public,
sans clé, et get_historical_klines pagine déjà. Il n'y a donc aucun obstacle.

Réserve importante, à ne jamais perdre de vue par la suite : les 40 paires
sont celles qui existent AUJOURD'HUI. Les projets morts ou radiés sont
absents. C'est un biais du survivant, et il grandit avec la profondeur de
l'historique. Il gonfle mécaniquement les rendements en absolu. Il affecte en
revanche beaucoup moins une comparaison RELATIVE entre deux groupes tirés du
même univers, puisque les deux jambes subissent le même biais — raison de plus
pour ne conclure que sur des écarts, jamais sur des niveaux.

Usage : python fetch_long_history.py
"""

import json
import logging
import os
import time

import pandas as pd

import config
import binance_client

logging.basicConfig(level=logging.WARNING, format="%(message)s")

MAX_DAYS = 3200  # ~8,8 ans, au-delà du listing de Binance pour la quasi-totalité
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "long_daily")


def load_long_daily(verbose=True):
    """
    Clôtures journalières sur l'historique le plus profond disponible.

    Les paires listées tardivement laissent des NaN en début de période. Ils ne
    sont pas remplis — ce serait inventer un historique. Ils sont exclus paire
    par paire et date par date au moment du classement.
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    series = {}
    for pair in config.PAIRS:
        symbol = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbol}_1d.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                candles = json.load(f)
        else:
            if verbose:
                print(f"  téléchargement {symbol}...", flush=True)
            candles = binance_client.get_historical_klines(symbol, interval="1d", days=MAX_DAYS)
            if candles:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(candles, f)
            time.sleep(0.25)  # courtoisie envers l'API publique
        if not candles or len(candles) < 200:
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
        df["date"] = pd.to_datetime(df["ts_ms"], unit="ms").dt.normalize()
        series[pair] = df.set_index("date")["price"].astype(float)
    if not series:
        return None
    return pd.DataFrame(series).sort_index()


if __name__ == "__main__":
    print(f"Téléchargement de l'historique maximum pour {len(config.PAIRS)} paires...\n", flush=True)
    prices = load_long_daily()
    print(f"\n{prices.shape[1]} paires, {prices.shape[0]} jours "
          f"({prices.index[0].date()} -> {prices.index[-1].date()})\n")

    starts = {c: prices[c].first_valid_index() for c in prices.columns}
    by_year = {}
    for c, d in starts.items():
        by_year.setdefault(d.year, []).append(c)
    print("Profondeur d'historique par année de première cotation :")
    for y in sorted(by_year):
        print(f"  {y} : {len(by_year[y]):>2} paires  ({', '.join(sorted(by_year[y])[:6])}"
              f"{'...' if len(by_year[y]) > 6 else ''})")

    counts = prices.notna().sum(axis=1)
    print(f"\nNombre de paires cotées simultanément :")
    for thresh in (10, 20, 30, 40):
        elig = counts[counts >= thresh]
        if len(elig):
            print(f"  >= {thresh:>2} paires à partir du {elig.index[0].date()} "
                  f"({len(elig)} jours, soit {len(elig)/7:.0f} rééquilibrages hebdomadaires)")
