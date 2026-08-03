"""
Peut-on émettre des signaux pendant les 41 % du temps où le filtre est fermé ?

Le problème commercial. Le moteur Force Relative n'émet rien quand le Bitcoin
est sous sa moyenne 200 jours, soit 41 % du temps, avec une fermeture observée
de 381 jours d'affilée. Pour un canal payant c'est un trou béant : l'abonné
paie et ne reçoit rien pendant parfois plus d'un an.

L'hypothèse symétrique, jamais testée. Si le classement par force relative
fonctionne — acheter les plus fortes bat acheter les plus faibles de +69,6
points par an — alors le même phénomène devrait s'observer à la baisse :
pendant un marché baissier, VENDRE À DÉCOUVERT les plus faibles devrait
rapporter. C'est exactement la même croyance (le momentum persiste), appliquée
dans l'autre sens, et elle remplirait exactement les périodes vides.

Ce qui doit être vérifié avant d'y croire, parce que la symétrie est séduisante
et souvent fausse en finance :

  1. Le short coûte cher. Un perpétuel paie un funding toutes les 8 heures, et
     en marché baissier il devient souvent NÉGATIF pour le short (les vendeurs
     étant majoritaires, ce sont eux qui paient). L'hypothèse retenue ici est
     donc défavorable, puis testée en sensibilité.
  2. Le risque est asymétrique et illimité. Un short subit des rebonds violents
     — un altcoin peut prendre +40 % en deux jours au milieu d'un marché
     baissier. Le stop n'est pas optionnel ici, contrairement au long.
  3. Le témoin aléatoire reste obligatoire. C'est lui qui a réfuté le momentum
     transversal (p = 0,885) alors qu'il paraissait excellent.

Trois variantes sont comparées :
  - VENTE des plus faibles quand le filtre long est FERMÉ (le cas qui nous
    intéresse : remplir les périodes vides) ;
  - VENTE des plus faibles en permanence (pour voir si la fermeture du filtre
    est bien le bon déclencheur) ;
  - ACHAT des plus fortes quand le filtre est fermé (le contrôle décisif : si
    acheter marche AUSSI en marché baissier, alors le filtre ne sert à rien et
    c'est toute la conclusion précédente qu'il faut revoir).

Usage : python backtest_faiblesse_baissier.py
"""

import json
import os
import random

import pandas as pd

import config
import binance_client
from backtest_rsi_inverse import rsi_frame

START = "2020-08-11"
FEE_ROUND_TRIP_PCT = 0.10
CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "long_daily")
HOLD_DAYS = 7
N_HOLD = 12
# Funding payé par le short, en % par jour. En marché baissier il est souvent
# défavorable au short : hypothèse volontairement pessimiste, testée ensuite.
SHORT_FUNDING_PCT_PER_DAY = 0.02


def load_ohlc():
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
        out[pair] = df.set_index("date")[["open", "high", "low", "close"]].astype(float)
    return out


def atr_series(df, period=14):
    prev = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev).abs(),
                    (df["low"] - prev).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()


def collect(ohlc, closes, rank, mask, sens, sl_mult=4.0, delay=1,
            funding=SHORT_FUNDING_PCT_PER_DAY, aleatoire=None):
    """
    `sens` vaut "vente" (short les plus faibles) ou "achat" (long les plus fortes).
    `mask` est la série booléenne des jours où l'on a le droit d'émettre.
    `aleatoire` : si un entier est fourni, la sélection est tirée au sort avec
    cette graine — c'est le témoin.
    """
    dates = closes.index
    atrs = {p: atr_series(ohlc[p]).reindex(dates) for p in closes.columns}
    rng = random.Random(aleatoire) if aleatoire is not None else None
    trades = []
    held = {}

    for i in range(30, len(dates) - HOLD_DAYS - delay):
        for pair, exp in list(held.items()):
            if i >= exp:
                del held[pair]
        if not bool(mask.get(dates[i], False)):
            continue

        classement = rank.iloc[i].dropna()
        classement = classement[classement.index[closes.iloc[i + delay][classement.index].notna()]]
        if len(classement) < 15:
            continue

        if rng is not None:
            choix = rng.sample(list(classement.index), min(N_HOLD, len(classement)))
        elif sens == "vente":
            choix = list(classement.nsmallest(N_HOLD).index)
        else:
            choix = list(classement.nlargest(N_HOLD).index)

        for pair in choix:
            if pair in held:
                continue
            e_idx = i + delay
            entry = closes[pair].iloc[e_idx]
            atr = atrs[pair].iloc[i]
            if pd.isna(entry) or entry <= 0 or pd.isna(atr) or atr <= 0:
                continue
            held[pair] = e_idx + HOLD_DAYS

            court = sens == "vente"
            stop = entry + sl_mult * atr if court else entry - sl_mult * atr
            bars = ohlc[pair].reindex(dates).iloc[e_idx + 1: e_idx + 1 + HOLD_DAYS]

            exit_px, raison = None, "expiration"
            for _, bar in bars.iterrows():
                if pd.isna(bar["low"]) or pd.isna(bar["high"]):
                    continue
                touche = bar["high"] >= stop if court else bar["low"] <= stop
                if touche:
                    exit_px, raison = stop, "stop"
                    break
            if exit_px is None:
                reste = bars["close"].dropna()
                if reste.empty:
                    continue
                exit_px = reste.iloc[-1]

            brut = (entry - exit_px) / entry if court else (exit_px - entry) / entry
            portage = (funding / 100.0) * HOLD_DAYS if court else 0.0
            trades.append({
                "date": dates[e_idx],
                "gain_pct": brut * 100 - FEE_ROUND_TRIP_PCT - portage * 100,
                "raison": raison,
            })
    return pd.DataFrame(trades)


def resume(t, label, n_days):
    if t.empty or len(t) < 30:
        print(f"  {label:<44} : trop peu de trades ({0 if t.empty else len(t)})")
        return None
    g = t["gain_pct"]
    annees = sorted(t["date"].dt.year.unique())
    par_an = [(y, t[t["date"].dt.year == y]["gain_pct"]) for y in annees]
    par_an = [(y, s) for y, s in par_an if len(s) >= 10]
    pos = sum(1 for _, s in par_an if s.mean() > 0)
    print(f"  {label:<44} : {len(g):>4} trades ({len(g)/(n_days/7):>4.1f}/sem) | "
          f"réussite {100*(g>0).mean():>4.1f} % | espérance {g.mean():>+6.2f} % | "
          f"années + {pos}/{len(par_an)}")
    return {"esperance": g.mean(), "n": len(g), "annees_pos": pos, "annees": len(par_an),
            "reussite": 100 * (g > 0).mean(), "par_an": par_an}


print("Chargement...", flush=True)
ohlc = load_ohlc()
closes = pd.DataFrame({p: d["close"] for p, d in ohlc.items()}).sort_index()
btc_full = closes["BTC/USDT"]
mm200 = btc_full > btc_full.rolling(200).mean()

closes = closes.loc[START:]
ohlc = {p: ohlc[p] for p in closes.columns}
n_days = len(closes)
rank = rsi_frame(closes, 21)

ouvert = mm200.reindex(closes.index).fillna(False)
ferme = ~ouvert
toujours = pd.Series(True, index=closes.index)

print(f"{closes.shape[1]} paires, {closes.index[0].date()} -> {closes.index[-1].date()}")
print(f"Filtre long ouvert {100*ouvert.mean():.0f} % du temps, fermé {100*ferme.mean():.0f} %")
print(f"Configuration : top {N_HOLD}, détention {HOLD_DAYS} j, stop 4x ATR, "
      f"funding short {SHORT_FUNDING_PCT_PER_DAY} %/j\n")

print("=== LES TROIS VARIANTES ===")
r_vente_ferme = resume(collect(ohlc, closes, rank, ferme.to_dict(), "vente"),
                       "VENTE des plus faibles, filtre FERMÉ", n_days)
r_vente_tout = resume(collect(ohlc, closes, rank, toujours.to_dict(), "vente"),
                      "VENTE des plus faibles, en permanence", n_days)
r_achat_ferme = resume(collect(ohlc, closes, rank, ferme.to_dict(), "achat"),
                       "ACHAT des plus fortes, filtre FERMÉ (contrôle)", n_days)
r_achat_ouvert = resume(collect(ohlc, closes, rank, ouvert.to_dict(), "achat"),
                        "ACHAT des plus fortes, filtre OUVERT (référence)", n_days)

print("\n=== TÉMOIN ALÉATOIRE (vente, filtre fermé, 40 tirages) ===")
print("Sans lui, aucune conclusion. C'est ce test qui a réfuté le momentum")
print("transversal alors qu'il paraissait excellent.\n")
temoins = []
for graine in range(40):
    t = collect(ohlc, closes, rank, ferme.to_dict(), "vente", aleatoire=graine)
    if not t.empty and len(t) >= 30:
        temoins.append(t["gain_pct"].mean())
if temoins and r_vente_ferme:
    mieux = sum(1 for v in temoins if v >= r_vente_ferme["esperance"])
    p = mieux / len(temoins)
    print(f"  Tirage au sort : espérance moyenne {sum(temoins)/len(temoins):+.2f} %, "
          f"médiane {sorted(temoins)[len(temoins)//2]:+.2f} %")
    print(f"  Sélection par faiblesse : {r_vente_ferme['esperance']:+.2f} %")
    print(f"  {mieux}/{len(temoins)} tirages font aussi bien ou mieux -> p = {p:.3f}")
    print(f"  {'>>> BAT LE HASARD' if p < 0.05 else 'indiscernable du hasard'}")

if r_vente_ferme:
    print("\n=== ANNÉE PAR ANNÉE, VENTE PENDANT LES FERMETURES ===")
    for y, s in r_vente_ferme["par_an"]:
        print(f"  {y} : {len(s):>4} trades | réussite {100*(s>0).mean():>4.1f} % | "
              f"espérance {s.mean():>+6.2f} %")

print("\n=== SENSIBILITÉ AU COÛT DU SHORT ===")
print("Si l'avantage ne survit qu'à funding nul, il n'est pas exploitable.\n")
for f in (0.0, 0.01, 0.02, 0.05):
    t = collect(ohlc, closes, rank, ferme.to_dict(), "vente", funding=f)
    if not t.empty:
        g = t["gain_pct"]
        print(f"  {f:.2f} %/jour ({f*365:>5.1f} %/an) : espérance {g.mean():+.2f} % | "
              f"réussite {100*(g>0).mean():.1f} %")

print("\n=== SENSIBILITÉ AU STOP (le short a un risque illimité) ===")
for sl in (2.0, 3.0, 4.0, 6.0):
    t = collect(ohlc, closes, rank, ferme.to_dict(), "vente", sl_mult=sl)
    if not t.empty:
        g = t["gain_pct"]
        stops = 100 * (t["raison"] == "stop").mean()
        print(f"  stop {sl:.0f}x ATR : espérance {g.mean():+.2f} % | réussite {100*(g>0).mean():.1f} % | "
              f"{stops:.0f} % de sorties sur stop | pire trade {g.min():+.1f} %")
