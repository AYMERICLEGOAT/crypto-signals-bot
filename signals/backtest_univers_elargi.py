"""
Augmenter la quantité sans diluer : élargir l'univers plutôt que le groupe de tête.

Le raisonnement. Il y a deux façons d'émettre plus de signaux avec un
classement transversal, et elles ne se valent pas du tout :

  - Prendre une PLUS GRANDE PART du même univers. C'est ce que fait
    RS_TOP_N = 12 sur 40 paires : on passe de 12,5 % à 30 % de l'univers, et la
    qualité baisse mécaniquement puisqu'on descend dans le classement.
    Mesuré : de +3,33 % (top 5) à +2,45 % (top 20).

  - Prendre la MÊME PART d'un univers PLUS LARGE. Top 30 sur 100 paires, c'est
    la même sélectivité que top 12 sur 40, mais 2,5 fois plus de signaux. Si le
    phénomène de momentum est réel et général, la qualité ne devrait pas bouger.

Binance cote 661 paires en USDT ; le projet n'en suit que 40. Le potentiel est
donc là. Mais trois objections sérieuses doivent être vérifiées, pas supposées :

  1. LA LIQUIDITÉ. Au-delà du rang 100 par volume, on tombe sous 2 M USDT de
     volume quotidien. Un signal sur une paire trop mince est inexécutable :
     l'abonné déplacerait le prix en entrant. Le module mesure donc la qualité
     par TRANCHE de liquidité, pour trouver où s'arrête l'univers exploitable.

  2. LE BIAIS DU SURVIVANT, aggravé. Les 40 paires actuelles sont déjà les
     survivantes d'aujourd'hui ; en descendant dans la capitalisation, la
     proportion de projets morts non représentés explose. Le résultat sera donc
     optimiste, et il faut le dire.

  3. LA PROFONDEUR D'HISTORIQUE. Beaucoup de petites paires sont listées
     récemment. Une paire qui n'existe que depuis 2024 ne peut pas contribuer à
     un test sur 6 ans, et l'inclure fausserait la comparaison.

Usage : python backtest_univers_elargi.py
"""

import json
import os
import time
import urllib.request

import pandas as pd

import binance_client
from backtest_rsi_inverse import rsi_frame
from backtest_rsi_production import collect_signals, stats

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "large_daily")
MAX_DAYS = 3200
N_PAIRES_CIBLE = 120
START = "2020-08-11"
HOLD = 7

STABLES = {
    "USDCUSDT", "FDUSDUSDT", "TUSDUSDT", "BUSDUSDT", "DAIUSDT", "EURUSDT",
    "USDPUSDT", "AEURUSDT", "XUSDUSDT", "USD1USDT", "PYUSDUSDT", "EURIUSDT",
}
SUFFIXES_EXCLUS = ("UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT")


def symboles_par_volume(n):
    """Les n paires USDT les plus liquides, hors stablecoins et tokens à levier."""
    req = urllib.request.Request(
        "https://api.binance.com/api/v3/ticker/24hr",
        headers={"User-Agent": "crypto-signals-bot"},
    )
    data = json.load(urllib.request.urlopen(req, timeout=30))
    rows = [
        d for d in data
        if d["symbol"].endswith("USDT")
        and d["symbol"] not in STABLES
        and not d["symbol"].endswith(SUFFIXES_EXCLUS)
    ]
    rows.sort(key=lambda d: -float(d["quoteVolume"]))
    return [(d["symbol"], float(d["quoteVolume"])) for d in rows[:n]]


def charger(symboles):
    os.makedirs(CACHE_DIR, exist_ok=True)
    series = {}
    for i, (symbole, _vol) in enumerate(symboles, 1):
        path = os.path.join(CACHE_DIR, f"{symbole}_1d.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                candles = json.load(f)
        else:
            if i % 20 == 0:
                print(f"  ... {i}/{len(symboles)}", flush=True)
            try:
                candles = binance_client.get_historical_klines(symbole, interval="1d", days=MAX_DAYS)
            except Exception:
                continue
            if candles:
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(candles, f)
            time.sleep(0.2)
        if not candles or len(candles) < 400:
            continue
        df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "close", "volume"])
        df["date"] = pd.to_datetime(df["ts_ms"], unit="ms").dt.normalize()
        series[symbole] = df.set_index("date")["close"].astype(float)
    return pd.DataFrame(series).sort_index()


def annees_positives(sig):
    if sig.empty:
        return 0, 0
    rows = []
    for y in sorted(sig["date"].dt.year.unique()):
        a = sig[sig["date"].dt.year == y]["gain_pct"]
        if len(a) >= 10:
            rows.append(a.mean() > 0)
    return sum(rows), len(rows)


print("Récupération du classement par volume...", flush=True)
symboles = symboles_par_volume(N_PAIRES_CIBLE)
volumes = dict(symboles)
print(f"{len(symboles)} paires visées. Téléchargement de l'historique...", flush=True)
prix = charger(symboles)
print(f"\n{prix.shape[1]} paires avec au moins 400 jours d'historique.\n", flush=True)

btc = prix["BTCUSDT"]
mask = (btc > btc.rolling(200).mean()).reindex(prix.loc[START:].index).fillna(False)
prix = prix.loc[START:]
n_days = len(prix)

# Seules les paires cotées dès le début participent, sinon la comparaison entre
# univers de tailles différentes mesure surtout des dates de listing.
completes = [c for c in prix.columns if prix[c].first_valid_index() is not None
             and prix[c].first_valid_index() <= prix.index[30]]
print(f"{len(completes)} paires cotées dès {prix.index[0].date()} : c'est l'univers exploitable.")
print(f"Période : {prix.index[0].date()} -> {prix.index[-1].date()}, "
      f"filtre ouvert {100*mask.mean():.0f} % du temps\n")


def mesurer(univers, top_n, etiquette):
    if top_n > len(univers):
        return None
    sous = prix[univers]
    rang = rsi_frame(sous, 21)
    sig = collect_signals(sous, rang, top_n, HOLD)
    if sig.empty:
        return None
    m = mask.to_dict()
    sig = sig[sig["date"].map(lambda d: bool(m.get(d, False)))]
    s = stats(sig, n_days)
    if not s or s["n"] < 100:
        return None
    pos, tot = annees_positives(sig)
    print(f"  {etiquette:<38} | {s['par_semaine']:>5.1f}/sem | {s['reussite']:>5.1f} % | "
          f"{s['esperance']:>+6.2f} % | {pos}/{tot}")
    return s


print("=== MÊME SÉLECTIVITÉ, UNIVERS DE TAILLES CROISSANTES ===")
print("Si le momentum est un phénomène général, prendre 30 % d'un univers deux")
print("fois plus grand doit donner deux fois plus de signaux à qualité égale.\n")
print(f"  {'configuration':<38} | {'signaux':>9} | {'réussite':>7} | {'espérance':>8} | années+")
for taille in (40, 60, 80, len(completes)):
    if taille > len(completes):
        continue
    univers = completes[:taille]
    top_n = max(5, round(taille * 0.30))
    mesurer(univers, top_n, f"{taille} paires, top {top_n} (30 %)")

print("\n=== À UNIVERS MAXIMAL, OÙ EST LA FRONTIÈRE ? ===")
print(f"  {'configuration':<38} | {'signaux':>9} | {'réussite':>7} | {'espérance':>8} | années+")
for top_n in (12, 20, 30, 40, 50):
    mesurer(completes, top_n, f"{len(completes)} paires, top {top_n}")

print("\n" + "=" * 78)
print("REPRISE SUR FENÊTRE COURTE, OÙ L'UNIVERS LARGE EXISTE VRAIMENT")
print("=" * 78)
print("""
Le test ci-dessus bute sur un fait dur : parmi les 120 paires les plus liquides
AUJOURD'HUI, très peu existaient en 2020. Comparer des univers de tailles
différentes sur 6 ans revient donc surtout à comparer des dates de listing, et
le « top 20 sur 24 paires » ci-dessus l'illustre — son espérance aberrante vient
d'un seul survivant extrême.

La question reste légitime sur une fenêtre plus courte, où l'univers large est
réellement coté. On perd de la puissance statistique, on gagne de la largeur.
Aucune conclusion définitive ne sera tirée d'ici : seulement un faisceau.
""")

START_COURT = "2023-01-01"
prix_c = prix.loc[START_COURT:]
mask_c = (btc > btc.rolling(200).mean()).reindex(prix_c.index).fillna(False)
n_days_c = len(prix_c)
completes_c = [c for c in prix_c.columns if prix_c[c].first_valid_index() is not None
               and prix_c[c].first_valid_index() <= prix_c.index[30]]
print(f"{len(completes_c)} paires cotées dès {prix_c.index[0].date()} "
      f"({n_days_c} jours, filtre ouvert {100*mask_c.mean():.0f} % du temps)\n")


def mesurer_court(univers, top_n, etiquette):
    if top_n > len(univers):
        return None
    sous = prix_c[univers]
    sig = collect_signals(sous, rsi_frame(sous, 21), top_n, HOLD)
    if sig.empty:
        return None
    m = mask_c.to_dict()
    sig = sig[sig["date"].map(lambda d: bool(m.get(d, False)))]
    s = stats(sig, n_days_c)
    if not s or s["n"] < 100:
        return None
    pos, tot = annees_positives(sig)
    # La médiane est reportée à côté de la moyenne : sur un univers de petites
    # capitalisations, un seul gagnant à +2000 % suffit à rendre la moyenne
    # ininterprétable, comme vu plus haut.
    med = sig["gain_pct"].median()
    print(f"  {etiquette:<34} | {s['par_semaine']:>5.1f}/sem | {s['reussite']:>5.1f} % | "
          f"{s['esperance']:>+7.2f} % | {med:>+6.2f} % | {pos}/{tot}")
    return s


print(f"  {'configuration':<34} | {'signaux':>9} | {'réussite':>7} | "
      f"{'moyenne':>9} | {'médiane':>7} | années+")
for taille in (24, 40, 60, len(completes_c)):
    if taille > len(completes_c):
        continue
    mesurer_court(completes_c[:taille], max(5, round(taille * 0.30)),
                  f"{taille} paires, top {round(taille*0.30)} (30 %)")

print("\n=== QUALITÉ PAR TRANCHE DE LIQUIDITÉ ===")
print("Un signal sur une paire trop mince est inexécutable : l'abonné déplacerait")
print("le prix en entrant. C'est ici que se décide la taille réelle de l'univers.\n")
print(f"  {'tranche':<38} | {'signaux':>9} | {'réussite':>7} | {'espérance':>8} | années+")
tranches = [(0, 30), (30, 60), (60, 90), (90, len(completes))]
for a, b in tranches:
    bloc = completes[a:b]
    if len(bloc) < 15:
        continue
    vols = [volumes.get(s, 0) / 1e6 for s in bloc]
    mesurer(bloc, max(5, round(len(bloc) * 0.30)),
            f"rangs {a+1}-{b} ({min(vols):.1f}-{max(vols):.0f} M$/j)")
