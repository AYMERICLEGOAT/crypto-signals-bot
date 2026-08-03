"""
Le stop-loss détruit-il l'avantage ? Test avant implémentation.

Ce qui est validé à ce stade. Classement par force relative sur données
journalières, filtre de tendance BTC > MM200, sortie au bout de 7 jours :
+83,3 %/an composé sur 6 ans, drawdown -63 %, aucune année perdante, 2,6
trades par semaine. La sortie est purement TEMPORELLE — aucun stop, aucun
objectif.

Le problème. Le canal diffuse des signaux avec stop-loss et objectifs, parce
que c'est ce qu'attendent les abonnés et ce que gère toute l'infrastructure
existante. Ajouter un stop à une stratégie validée sans stop, c'est diffuser
une stratégie DIFFÉRENTE de celle qui a été mesurée. C'est précisément le
mécanisme qui a produit le « 61,2 % de réussite » affiché à tort pendant des
mois : un chiffre mesuré sur une variante, annoncé pour une autre.

Ce module mesure donc l'effet exact du stop, en simulant les mèches intrajour
sur les bougies journalières : à chaque jour de détention, si le plus BAS
touche le stop, la position est fermée au stop ; si le plus HAUT touche
l'objectif, elle est fermée à l'objectif. Le stop est prioritaire en cas
d'ambiguïté sur la même bougie, hypothèse défavorable et donc honnête.

Plusieurs distances sont comparées, en multiples de l'ATR(14) journalier, et
la question posée est simple : à partir de quelle largeur le stop cesse-t-il
de coûter plus qu'il ne protège ?

Usage : python backtest_stop_impact.py
"""

import json
import os

import pandas as pd

import config
import binance_client
from backtest_rsi_inverse import rsi_frame

START = "2020-08-11"
FEE_ROUND_TRIP_PCT = 0.10
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "long_daily")
HOLD_DAYS = 7
N_HOLD = 5


def load_ohlc():
    """Ouvre / haut / bas / clôture journaliers, depuis le cache déjà constitué."""
    out = {}
    for pair in config.PAIRS:
        symbol = binance_client.pair_to_symbol(pair)
        path = os.path.join(CACHE_DIR, f"{symbol}_1d.json")
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8") as f:
            candles = json.load(f)
        if not candles or len(candles) < 200:
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "close", "volume"])
        df["date"] = pd.to_datetime(df["ts_ms"], unit="ms").dt.normalize()
        df = df.set_index("date")[["open", "high", "low", "close"]].astype(float)
        out[pair] = df
    return out


def atr_series(df, period=14):
    """ATR de Wilder sur bougies journalières."""
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(),
                    (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def simulate(ohlc, closes, rank_frame, trend_mask, sl_mult, tp_mult, delay=1):
    """
    Émet les mêmes signaux que la stratégie validée, mais les clôture sur
    stop, objectif, ou expiration à HOLD_DAYS jours — le premier des trois.
    sl_mult = None signifie « aucun stop », soit exactement la stratégie de
    référence, ce qui permet de vérifier que le module reproduit bien ses
    chiffres avant d'en tirer une conclusion.
    """
    dates = closes.index
    atrs = {p: atr_series(ohlc[p]).reindex(dates) for p in closes.columns}
    trades = []
    held = {}

    for i in range(30, len(dates) - HOLD_DAYS - delay):
        for pair, exp in list(held.items()):
            if i >= exp:
                del held[pair]
        if not bool(trend_mask.get(dates[i], False)):
            continue

        rank = rank_frame.iloc[i].dropna()
        rank = rank[rank.index[closes.iloc[i + delay][rank.index].notna()]]
        if len(rank) < 15:
            continue

        for pair in rank.nlargest(N_HOLD).index:
            if pair in held:
                continue
            e_idx = i + delay
            entry = closes[pair].iloc[e_idx]
            atr = atrs[pair].iloc[i]
            if pd.isna(entry) or entry <= 0 or pd.isna(atr) or atr <= 0:
                continue
            held[pair] = e_idx + HOLD_DAYS

            stop = entry - sl_mult * atr if sl_mult else None
            target = entry + tp_mult * atr if tp_mult else None
            bars = ohlc[pair].reindex(dates).iloc[e_idx + 1: e_idx + 1 + HOLD_DAYS]

            exit_px, reason = None, "expiration"
            for _, bar in bars.iterrows():
                if pd.isna(bar["low"]) or pd.isna(bar["high"]):
                    continue
                # Le stop est évalué en premier : hypothèse défavorable
                # lorsque stop et objectif tombent dans la même bougie.
                if stop is not None and bar["low"] <= stop:
                    exit_px, reason = stop, "stop"
                    break
                if target is not None and bar["high"] >= target:
                    exit_px, reason = target, "objectif"
                    break
            if exit_px is None:
                last = bars["close"].dropna()
                if last.empty:
                    continue
                exit_px = last.iloc[-1]

            trades.append({
                "date": dates[e_idx],
                "gain_pct": (exit_px - entry) / entry * 100 - FEE_ROUND_TRIP_PCT,
                "reason": reason,
            })
    return pd.DataFrame(trades)


def report(t, label):
    if t.empty:
        print(f"  {label} : aucun trade")
        return
    g = t["gain_pct"]
    years = (t["date"].max() - t["date"].min()).days / 365.25
    reasons = t["reason"].value_counts(normalize=True) * 100
    # Croissance composée d'un portefeuille à N_HOLD emplacements : chaque
    # trade pèse 1/N_HOLD du capital. C'est une approximation, mais elle ne
    # surestime pas comme le ferait la moyenne arithmétique.
    compose = (1 + g / 100 / N_HOLD).prod() ** (1 / years) - 1
    print(f"  {label}")
    print(f"    {len(g)} trades ({len(g)/years/52:.1f}/sem) | réussite {100*(g>0).mean():.1f} % | "
          f"espérance {g.mean():+.2f} % | composé ~{compose*100:+.0f} %/an")
    print(f"    sorties : " + "  ".join(f"{k} {v:.0f} %" for k, v in reasons.items()))


print("Chargement des bougies OHLC...", flush=True)
ohlc = load_ohlc()
closes = pd.DataFrame({p: d["close"] for p, d in ohlc.items()}).sort_index()
old = [c for c in closes.columns
       if closes[c].first_valid_index() is not None and closes[c].first_valid_index().year <= 2019]

btc_full = closes["BTC/USDT"]
mm200_full = btc_full > btc_full.rolling(200).mean()

closes = closes.loc[START:][old]
ohlc = {p: ohlc[p] for p in old}
mask = mm200_full.reindex(closes.index).fillna(False).to_dict()
rank = rsi_frame(closes, 21)

print(f"{len(old)} paires, {closes.index[0].date()} -> {closes.index[-1].date()}")
print(f"Configuration : top {N_HOLD}, détention max {HOLD_DAYS} jours, filtre BTC > MM200\n")

print("=== RÉFÉRENCE : SORTIE PUREMENT TEMPORELLE (stratégie validée) ===")
ref = simulate(ohlc, closes, rank, mask, None, None)
report(ref, "aucun stop, aucun objectif")

print("\n=== EFFET DU STOP SEUL ===")
print("Le stop protège des pires trades mais coupe aussi les positions qui")
print("seraient revenues. Le solde net est ce qui compte.\n")
for sl in (1.0, 1.5, 2.0, 3.0, 4.0, 6.0):
    report(simulate(ohlc, closes, rank, mask, sl, None), f"stop à {sl:.1f} x ATR")

print("\n=== STOP + OBJECTIF ===")
print("Un objectif ferme les gagnants tôt. Sur une stratégie dont les gains")
print("viennent de rares très gros mouvements, c'est en général coûteux.\n")
for sl, tp in ((2.0, 3.0), (2.0, 6.0), (3.0, 6.0), (3.0, 9.0), (4.0, 8.0), (4.0, 12.0)):
    report(simulate(ohlc, closes, rank, mask, sl, tp), f"stop {sl:.0f} x ATR / objectif {tp:.0f} x ATR")
