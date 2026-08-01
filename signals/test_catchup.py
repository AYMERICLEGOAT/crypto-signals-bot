"""
Vérification de la fenêtre de rattrapage (audit du 01/08/2026).

Sans dépendance de test externe (le projet n'en embarque aucune) : plain
asserts, lancé par `python test_catchup.py`. Retourne un code de sortie non
nul si une vérification échoue.

La propriété critique testée ici est l'ABSENCE DE REGARD VERS LE FUTUR :
évaluer la bougie k d'un DataFrame complet doit donner exactement le même
résultat que d'évaluer la dernière bougie d'un DataFrame tronqué à k. Si
cette propriété tombait, le rattrapage "découvrirait" des signaux en
utilisant des données postérieures à la bougie — des signaux impossibles à
prendre en réel, qui gonfleraient artificiellement les statistiques.
"""
import json
import os
import sys

import pandas as pd

import config
import binance_client
from indicators import compute_all_indicators
from strategy import detect_signal, detect_signals_with_catchup, is_still_actionable

CACHE_DIR = os.path.join(os.path.dirname(__file__), "data", "diag_cache")
failures = []


def check(condition, label):
    if condition:
        print(f"  OK   {label}")
    else:
        print(f"  ECHEC {label}")
        failures.append(label)


def load_enriched(pair):
    symbol = binance_client.pair_to_symbol(pair)
    path = os.path.join(CACHE_DIR, f"{symbol}_1h_90d.json")
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        candles = json.load(f)
    if not candles or len(candles) < 500:
        return None
    df = pd.DataFrame(candles, columns=["ts_ms", "open", "high", "low", "price", "volume"])
    return compute_all_indicators(
        df, config.EMA_FAST_PERIOD, config.EMA_SLOW_PERIOD,
        config.RSI_PERIOD, config.BOLLINGER_PERIOD, config.BOLLINGER_STD,
    ).reset_index(drop=True)


print("\n[1] Absence de regard vers le futur (at_index == évaluation tronquée)")
tested = mismatches = signals_seen = 0
for pair in list(config.PAIRS)[:8]:
    e = load_enriched(pair)
    if e is None:
        continue
    n = len(e)
    for k in range(n - 200, n):  # 200 dernières bougies
        full = detect_signal(e, pair, config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD, at_index=k)
        truncated = detect_signal(
            e.iloc[: k + 1].reset_index(drop=True), pair,
            config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD,
        )
        tested += 1
        if (full is None) != (truncated is None):
            mismatches += 1
        elif full is not None:
            signals_seen += 1
            if (full["type"], full["entry_price"], full["stop_loss"]) != (
                truncated["type"], truncated["entry_price"], truncated["stop_loss"]
            ):
                mismatches += 1

check(tested > 500, f"assez de bougies comparées ({tested})")
check(signals_seen > 0, f"au moins un vrai signal dans l'échantillon ({signals_seen})")
check(mismatches == 0, f"aucune divergence at_index vs tronqué ({mismatches} divergence(s))")

print("\n[2] Récupération des signaux perdus par les cycles cron sautés")
# Reproduit le vrai problème de production : le cron ne se déclenche qu'une
# fois toutes les ~3 bougies au lieu de chaque heure. On compare, sur les
# mêmes données, ce que voit un cycle qui n'examine QUE la dernière bougie
# (ancien comportement) et ce que voit la fenêtre de rattrapage (nouveau).
CRON_EVERY = 3  # une exécution toutes les 3 bougies horaires (cadence réelle observée)
truth_total = old_caught = new_caught = 0

for pair in config.PAIRS:
    e = load_enriched(pair)
    if e is None:
        continue
    n = len(e)
    start = n - 300
    # Vérité terrain : toutes les bougies qui portent réellement un signal.
    truth = {
        k for k in range(start, n)
        if detect_signal(e, pair, config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD, at_index=k)
    }
    truth_total += len(truth)
    if not truth:
        continue

    for run_idx in range(start, n, CRON_EVERY):
        # Ancien comportement : seule la bougie du cycle est regardée.
        if run_idx in truth:
            old_caught += 1
        # Nouveau : la fenêtre de rattrapage couvre les bougies précédentes.
        window_start = max(start, run_idx - config.SIGNAL_CATCHUP_CANDLES + 1)
        new_caught += len(truth & set(range(window_start, run_idx + 1)))

check(truth_total > 0, f"des signaux réels existent dans l'échantillon ({truth_total})")
check(new_caught > old_caught, f"le rattrapage récupère plus de signaux ({new_caught} vs {old_caught})")
if truth_total:
    print(f"       {truth_total} signaux réels | sans rattrapage : {old_caught} vus "
          f"({100*old_caught/truth_total:.0f}%) | avec rattrapage : {new_caught} occasions de détection")

print("\n[3] Garde-fou de fraîcheur (is_still_actionable)")
buy = {"type": "BUY", "entry_price": 100.0, "stop_loss": 97.0, "tp1_price": 104.0, "take_profit": 108.0}
check(is_still_actionable(buy, 100.5), "BUY encore prenable juste au-dessus de l'entrée")
check(not is_still_actionable(buy, 96.0), "BUY rejeté si le stop a déjà été franchi")
check(not is_still_actionable(buy, 104.5), "BUY rejeté si TP1 est déjà atteint")
check(not is_still_actionable(buy, 103.0), "BUY rejeté si le prix a trop dérivé vers TP1 (75% du chemin)")
check(is_still_actionable(buy, 101.0), "BUY accepté à 25% du chemin vers TP1 (sous le seuil de 35%)")

sell = {"type": "SELL", "entry_price": 100.0, "stop_loss": 103.0, "tp1_price": 96.0, "take_profit": 92.0}
check(is_still_actionable(sell, 99.5), "SELL encore prenable juste sous l'entrée")
check(not is_still_actionable(sell, 104.0), "SELL rejeté si le stop a déjà été franchi")
check(not is_still_actionable(sell, 95.5), "SELL rejeté si TP1 est déjà atteint")
check(not is_still_actionable(sell, 97.0), "SELL rejeté si le prix a trop dérivé vers TP1")
check(is_still_actionable(sell, 99.0), "SELL accepté à 25% du chemin vers TP1")
check(not is_still_actionable(buy, 0), "prix invalide rejeté")

print("\n[4] Bornes de detect_signals_with_catchup")
e = load_enriched("BTC/USDT")
if e is not None:
    found = detect_signals_with_catchup(e, "BTC/USDT", config.RSI_BUY_THRESHOLD, config.RSI_SELL_THRESHOLD)
    check(len(found) <= config.SIGNAL_CATCHUP_CANDLES, f"jamais plus de signaux que de bougies balayées ({len(found)})")
    check(all("candle_ts_ms" in s for s in found), "chaque signal rattrapé porte l'horodatage de sa bougie")
    tiny = e.iloc[:1].reset_index(drop=True)
    check(detect_signals_with_catchup(tiny, "BTC/USDT", 40, 60) == [], "DataFrame trop court -> aucun signal, pas d'exception")

print()
if failures:
    print(f"ECHEC : {len(failures)} vérification(s) en échec :")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("Toutes les vérifications passent.")
